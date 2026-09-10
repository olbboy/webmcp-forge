import { afterAll, describe, expect, it } from "vitest";
import { applySelection, buildManifest, generateEmbedJs } from "@/lib/generator";
import { closeBrowser, getBrowser, scanSite } from "@/lib/scanner";
import type { ScanJob, ToolCandidate } from "@/lib/types";
import { startFixtureServer, unwrapToolResult } from "./helpers";

/**
 * `click_by_text` used to match any substring against every clickable element
 * on the page, so "delete" would find "Delete account". These cover the gate
 * that replaced it, and the case that matters most is the one asserting no
 * click happened at all — a refusal that still pressed something would look
 * identical in the return value.
 */

function jobFrom(scan: Awaited<ReturnType<typeof scanSite>>): ScanJob {
  return {
    id: "job_clickgate00001",
    url: scan.url,
    origin: scan.origin,
    status: "ready",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pages: scan.pages,
    candidates: scan.candidates,
    includeLocalRelay: false,
  };
}

async function pageWithEmbed(fixtureUrl: string, tools: ToolCandidate[], job: ScanJob) {
  const js = generateEmbedJs(
    buildManifest(job, tools, false, 1, new Date().toISOString())
  );
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.goto(`${fixtureUrl}/index.html`, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: js });
  await page.waitForFunction(() =>
    Boolean(
      (window as unknown as { __WEBMCP_FORGE_READY__?: Promise<unknown> })
        .__WEBMCP_FORGE_READY__
    )
  );
  await page.evaluate(
    () =>
      (window as unknown as { __WEBMCP_FORGE_READY__: Promise<unknown> })
        .__WEBMCP_FORGE_READY__
  );
  // Counts every click that reaches the document, so a refusal can be shown to
  // have pressed nothing rather than merely reporting that it did not.
  await page.evaluate(() => {
    (window as unknown as { __CLICKS__: number }).__CLICKS__ = 0;
    document.addEventListener(
      "click",
      () => {
        (window as unknown as { __CLICKS__: number }).__CLICKS__ += 1;
      },
      true
    );
  });
  return page;
}

function callTool(page: Awaited<ReturnType<typeof pageWithEmbed>>, text: string) {
  return page.evaluate(async (value) => {
    const ctx = document.modelContext || navigator.modelContext;
    if (!ctx?.executeTool) throw new Error("modelContext missing");
    const result = await ctx.executeTool("click_by_text", JSON.stringify({ text: value }));
    return {
      result,
      clicks: (window as unknown as { __CLICKS__: number }).__CLICKS__,
    };
  }, text);
}

describe("click_by_text is limited to what the scan saw", () => {
  afterAll(async () => {
    await closeBrowser();
  });

  it("presses a label from the allowlist, and refuses one that is not, without clicking", async () => {
    const fixture = await startFixtureServer();
    let page;
    try {
      const scan = await scanSite(`${fixture.url}/index.html`);
      const job = jobFrom(scan);
      const click = scan.candidates.find((c) => c.kind === "click_by_text");
      expect(click, "the fixture should produce a click tool").toBeTruthy();

      const allowlist = (click?.metadata?.allowlist ?? []) as string[];
      expect(allowlist.length).toBeGreaterThan(0);
      // Anchors count as clickable and always did at call time; leaving them
      // out of the list would refuse "Catalog" on a site that renders its nav
      // as links.
      expect(
        allowlist.some((label) => /catalog/i.test(label)),
        "links belong in the allowlist, not just buttons"
      ).toBe(true);

      page = await pageWithEmbed(fixture.url, [click as ToolCandidate], job);

      const denied = await callTool(page, "Delete account");
      const deniedData = unwrapToolResult(denied.result);
      expect(deniedData.ok).toBe(false);
      expect(String(deniedData.error)).toMatch(/not in the allowlist/i);
      expect(denied.clicks, "a refusal must not press anything").toBe(0);

      // A substring of a real entry is still a refusal. Allowing it would
      // reproduce the original defect inside a shorter list.
      const partial = await callTool(page, "cata");
      expect(unwrapToolResult(partial.result).ok).toBe(false);
      expect(partial.clicks).toBe(0);

      const allowed = await callTool(page, allowlist[0]);
      expect(unwrapToolResult(allowed.result).ok).toBe(true);
      expect(allowed.clicks).toBeGreaterThan(0);
    } finally {
      if (page) await page.close();
      await fixture.close();
    }
  });

  it("is not offered at all when the page has nothing to click", async () => {
    const empty = { candidates: [] as ToolCandidate[] };
    // proposeTools is exercised through scanSite elsewhere; here the point is
    // the contract: no controls, no tool.
    const { proposeTools } = await import("@/lib/heuristics");
    const tools = proposeTools(
      [
        {
          url: "https://example.test/",
          title: "Bare",
          headings: [],
          navLinks: [],
          links: [],
          forms: [],
          buttons: [],
          searchInputs: [],
          products: [],
          filters: [],
        },
      ],
      "https://example.test"
    );
    expect(tools.some((t) => t.kind === "click_by_text")).toBe(false);
    expect(empty.candidates).toHaveLength(0);
  });

  it("recovers a list for a job scanned before allowlists existed", async () => {
    const fixture = await startFixtureServer();
    try {
      const scan = await scanSite(`${fixture.url}/index.html`);
      const click = scan.candidates.find((c) => c.kind === "click_by_text");
      expect(click).toBeTruthy();

      // Exactly what an older job holds: the tool with no metadata at all,
      // alongside the pages the scan recorded.
      const legacy: ToolCandidate = { ...(click as ToolCandidate) };
      delete legacy.metadata;
      const job = jobFrom({ ...scan, candidates: [legacy] });

      const rebuilt = applySelection(job, undefined);
      const rebuiltClick = rebuilt.find((t) => t.kind === "click_by_text");
      expect(rebuiltClick?.metadata?.allowlist).toBeDefined();
      expect(
        (rebuiltClick?.metadata?.allowlist as string[]).length,
        "an old job must not come back with a tool that refuses everything"
      ).toBeGreaterThan(0);
    } finally {
      await fixture.close();
    }
  });
});

describe("safety hints reach the browser", () => {
  afterAll(async () => {
    await closeBrowser();
  });

  it("passes annotations to registerTool and reports them from getTools", async () => {
    const fixture = await startFixtureServer();
    let page;
    try {
      const scan = await scanSite(`${fixture.url}/index.html`);
      const job = jobFrom(scan);
      page = await pageWithEmbed(fixture.url, scan.candidates, job);

      const byName = await page.evaluate(async () => {
        const ctx = document.modelContext || navigator.modelContext;
        if (!ctx) throw new Error("modelContext missing");
        const tools = await ctx.getTools();
        return Object.fromEntries(
          tools.map((t) => [t.name, (t as { annotations?: unknown }).annotations])
        ) as Record<string, Record<string, boolean> | undefined>;
      });

      expect(byName.get_page_info?.readOnlyHint).toBe(true);
      expect(byName.click_by_text?.consequentialHint).toBe(true);
      // The tool description carries button text lifted from the scanned site,
      // which is content the client should not treat as trusted.
      expect(byName.click_by_text?.untrustedContentHint).toBe(true);
      expect(byName.open_path?.consequentialHint).toBe(true);
    } finally {
      if (page) await page.close();
      await fixture.close();
    }
  });

  it("hands annotations to a modelContext the page already had", async () => {
    // installPolyfill returns a native context untouched, so the polyfill's own
    // getTools proves nothing about that path. This one spies on a context
    // installed before the embed loads.
    const fixture = await startFixtureServer();
    let page;
    try {
      const scan = await scanSite(`${fixture.url}/index.html`);
      const job = jobFrom(scan);
      const js = generateEmbedJs(
        buildManifest(job, scan.candidates, false, 1, new Date().toISOString())
      );
      const browser = await getBrowser();
      page = await browser.newPage();
      await page.goto(`${fixture.url}/index.html`, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => {
        const seen: Array<{ name: string; annotations?: unknown }> = [];
        (window as unknown as { __SEEN__: typeof seen }).__SEEN__ = seen;
        Object.defineProperty(document, "modelContext", {
          configurable: true,
          value: {
            registerTool(tool: { name: string; annotations?: unknown }) {
              seen.push({ name: tool.name, annotations: tool.annotations });
              return Promise.resolve();
            },
            getTools: () => Promise.resolve([]),
            addEventListener() {},
            dispatchEvent() {
              return true;
            },
          },
        });
      });
      await page.addScriptTag({ content: js });
      await page.waitForFunction(() =>
        Boolean(
          (window as unknown as { __WEBMCP_FORGE_READY__?: Promise<unknown> })
            .__WEBMCP_FORGE_READY__
        )
      );
      await page.evaluate(
        () =>
          (window as unknown as { __WEBMCP_FORGE_READY__: Promise<unknown> })
            .__WEBMCP_FORGE_READY__
      );

      const seen = (await page.evaluate(
        () => (window as unknown as { __SEEN__: Array<{ name: string; annotations?: Record<string, boolean> }> }).__SEEN__
      )) as Array<{ name: string; annotations?: Record<string, boolean> }>;

      const info = seen.find((t) => t.name === "get_page_info");
      expect(info?.annotations?.readOnlyHint).toBe(true);
    } finally {
      if (page) await page.close();
      await fixture.close();
    }
  });
});
