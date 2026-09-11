import http from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import { POST as applyPost } from "@/app/api/jobs/[id]/rescan/apply/route";
import {
  DELETE as rescanDelete,
  POST as rescanPost,
} from "@/app/api/jobs/[id]/rescan/route";
import { diffTools, mergeProposal } from "@/lib/rescan";
import { closeBrowser } from "@/lib/scanner";
import { getJob, saveJob } from "@/lib/store";
import type { RescanProposal, ScanJob, ToolCandidate } from "@/lib/types";

/**
 * Re-scanning exists so that a site changing does not cost its owner the script
 * tag on their pages. The things worth proving are therefore what it keeps:
 * the job's identity, and every decision the owner had already made about the
 * tools.
 */

function tool(
  id: string,
  overrides: Partial<ToolCandidate> = {}
): ToolCandidate {
  return {
    id,
    name: id,
    description: `the ${id} tool`,
    kind: "fill_form",
    enabled: true,
    inputSchema: { type: "object", properties: {} },
    selectors: { form: ["form.original"] },
    ...overrides,
  };
}

describe("working out what changed", () => {
  it("reports a tool the scan no longer finds as removed", () => {
    const changes = diffTools([tool("a"), tool("b")], [tool("a")]);
    const b = changes.find((c) => c.id === "b");
    expect(b?.change).toBe("removed");
  });

  it("reports a tool the scan found for the first time as added", () => {
    const changes = diffTools([tool("a")], [tool("a"), tool("c")]);
    expect(changes.find((c) => c.id === "c")?.change).toBe("added");
  });

  it("notices when a tool points at different markup", () => {
    const changes = diffTools(
      [tool("a")],
      [tool("a", { selectors: { form: ["form.redesigned"] } })]
    );
    expect(changes.find((c) => c.id === "a")?.change).toBe("updated");
  });

  it("does not call a rename a change to the site", () => {
    // The owner is allowed to rename a tool. A scan re-deriving the original
    // name must not report that back to them as something their site did.
    const changes = diffTools(
      [tool("a", { name: "send_us_a_message", description: "ours" })],
      [tool("a", { name: "fill_form_contact", description: "generated" })]
    );
    expect(changes.find((c) => c.id === "a")?.change).toBe("unchanged");
  });

  it("counts a shrinking allowlist as an update, and says by how much", () => {
    const before = tool("click_by_text", {
      kind: "click_by_text",
      selectors: undefined,
      metadata: { allowlist: ["One", "Two", "Three"] },
    });
    const after = tool("click_by_text", {
      kind: "click_by_text",
      selectors: undefined,
      metadata: { allowlist: ["One"] },
    });
    const change = diffTools([before], [after])[0];
    expect(change.change).toBe("updated");
    expect(change.detail).toMatch(/3 → 1/);
  });
});

describe("accepting a re-scan", () => {
  function jobWith(
    candidates: ToolCandidate[],
    selected?: ScanJob["selected"]
  ): ScanJob {
    return {
      id: "job_rescanmerge001",
      url: "https://example.test/",
      origin: "https://example.test",
      status: "generated",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pages: [],
      candidates,
      selected,
      includeLocalRelay: false,
      version: 3,
      publicId: "pub_ffffffffffffffffffffffffffffffff",
    };
  }

  function proposalOf(candidates: ToolCandidate[]): RescanProposal {
    return {
      scannedAt: new Date().toISOString(),
      url: "https://example.test/",
      origin: "https://example.test",
      pages: [],
      candidates,
      changes: [],
    };
  }

  it("keeps the name the owner gave a tool, and keeps it switched off", () => {
    const job = jobWith(
      [tool("a"), tool("b")],
      [
        { id: "a", name: "send_us_a_message", description: "ours", enabled: true },
        { id: "b", name: "b", description: "the b tool", enabled: false },
      ]
    );
    const merged = mergeProposal(job, proposalOf([tool("a"), tool("b")]));

    const a = merged.candidates.find((t) => t.id === "a");
    const b = merged.candidates.find((t) => t.id === "b");
    expect(a?.name, "a rename survives a re-scan").toBe("send_us_a_message");
    expect(a?.description).toBe("ours");
    expect(b?.enabled, "a tool they switched off stays off").toBe(false);
  });

  it("brings a newly found tool in switched off", () => {
    const job = jobWith([tool("a")]);
    const merged = mergeProposal(job, proposalOf([tool("a"), tool("new")]));

    const added = merged.candidates.find((t) => t.id === "new");
    expect(
      added?.enabled,
      "nobody has chosen this one, so it does not start answering agents"
    ).toBe(false);
    expect(merged.candidates.find((t) => t.id === "a")?.enabled).toBe(true);
  });

  it("moves the version on, so two bundles never share a number", () => {
    const job = jobWith([tool("a")]);
    const merged = mergeProposal(job, proposalOf([tool("a", { selectors: { form: ["form.new"] } })]));

    // A rebuild of a missing artifact reads the version off the job. Left
    // alone, the same number would come to mean two different bundles — and
    // the CDN hands that number out as its cache validator.
    expect(merged.version).toBe(4);
    expect(merged.status, "the files on disk no longer match the tools").toBe(
      "ready"
    );
    expect(merged.publicId, "the script tag on the site keeps working").toBe(
      "pub_ffffffffffffffffffffffffffffffff"
    );
    expect(merged.pendingRescan).toBeUndefined();
  });

  it("drops a health report that was about the previous tools", () => {
    const job = {
      ...jobWith([tool("a")]),
      health: {
        checkedAt: new Date().toISOString(),
        pagesChecked: 1,
        pagesFailed: 0,
        tools: [
          { id: "a", name: "a", kind: "fill_form" as const, status: "ok" as const },
        ],
      },
    };
    const merged = mergeProposal(job, proposalOf([tool("b")]));
    expect(
      merged.health,
      "verdicts about tools that are gone would sit beside tools they never described"
    ).toBeUndefined();
  });
});

describe("through the API, against a site that changed", () => {
  afterAll(async () => {
    await closeBrowser();
  });

  function startSite(html: () => string) {
    return new Promise<{ url: string; close: () => Promise<void> }>(
      (resolve, reject) => {
        const server = http.createServer((req, res) => {
          if (req.url === "/robots.txt") {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(html());
        });
        server.listen(0, "127.0.0.1", () => {
          const address = server.address();
          if (!address || typeof address === "string") {
            reject(new Error("bind failed"));
            return;
          }
          resolve({
            url: `http://127.0.0.1:${address.port}`,
            close: () =>
              new Promise<void>((done, fail) =>
                server.close((err) => (err ? fail(err) : done()))
              ),
          });
        });
      }
    );
  }

  const params = (id: string) => ({ params: Promise.resolve({ id }) });
  const post = (url: string) => new Request(url, { method: "POST" });

  it("leaves the job alone until the proposal is accepted", async () => {
    let markup = `<!doctype html><title>Shop</title>
      <form name="contact"><input name="email"></form>
      <a href="/catalog">Catalog</a>`;
    const site = await startSite(() => markup);

    try {
      const id = "job_rescanflow001";
      // A job as it stands after a scan and a generate: an id, a public id
      // baked into somebody's page, and a tool the owner renamed.
      const { runScan } = await import("@/lib/jobs");
      const scanned = await runScan(`${site.url}/`, site.url);
      const original: ScanJob = {
        ...scanned,
        id,
        status: "generated",
        version: 2,
        publicId: "pub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        selected: scanned.candidates.map((t) => ({
          id: t.id,
          name: t.id === "click_by_text" ? "press_something" : t.name,
          description: t.description,
          enabled: t.kind !== "list_links",
        })),
      };
      await saveJob(original);

      // The site loses its form.
      markup = `<!doctype html><title>Shop</title><a href="/catalog">Catalog</a>`;

      const proposed = await rescanPost(
        post("http://scanner.test/x"),
        params(id)
      );
      expect(proposed.status).toBe(200);

      const parked = await getJob(id);
      expect(parked?.pendingRescan, "the scan is parked").toBeTruthy();
      expect(
        parked?.candidates.some((t) => t.kind === "fill_form"),
        "and the live tool list is untouched"
      ).toBe(true);
      expect(parked?.version, "nothing has been rebuilt").toBe(2);
      expect(
        parked?.pendingRescan?.changes.some(
          (c) => c.change === "removed" && c.kind === "fill_form"
        ),
        "the diff says the form tool is gone"
      ).toBe(true);

      const applied = await applyPost(post("http://scanner.test/x"), params(id));
      expect(applied.status).toBe(200);

      const after = await getJob(id);
      expect(after?.id, "same job").toBe(id);
      expect(
        after?.publicId,
        "same public id — the script tag on the site still works"
      ).toBe("pub_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
      expect(after?.candidates.some((t) => t.kind === "fill_form")).toBe(false);
      expect(
        after?.candidates.find((t) => t.id === "click_by_text")?.name,
        "the rename survived"
      ).toBe("press_something");
      expect(
        after?.candidates.find((t) => t.kind === "list_links")?.enabled,
        "and so did the switch they turned off"
      ).toBe(false);
      expect(after?.pendingRescan).toBeUndefined();
      expect(after?.version).toBe(3);
    } finally {
      await site.close();
    }
  });

  it("discarding puts everything back the way it was", async () => {
    const markup = `<!doctype html><title>Shop</title>
      <form name="contact"><input name="email"></form>`;
    const site = await startSite(() => markup);
    try {
      const id = "job_rescandiscard1";
      const { runScan } = await import("@/lib/jobs");
      const scanned = await runScan(`${site.url}/`, site.url);
      await saveJob({ ...scanned, id });

      await rescanPost(post("http://scanner.test/x"), params(id));
      expect((await getJob(id))?.pendingRescan).toBeTruthy();

      const discarded = await rescanDelete(
        new Request("http://scanner.test/x", { method: "DELETE" }),
        params(id)
      );
      expect(discarded.status).toBe(200);

      const after = await getJob(id);
      expect(after?.pendingRescan).toBeUndefined();
      expect(after?.candidates.length).toBe(scanned.candidates.length);
    } finally {
      await site.close();
    }
  });
});
