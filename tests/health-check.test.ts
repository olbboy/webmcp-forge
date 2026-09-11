import http from "node:http";
import { afterAll, describe, expect, it } from "vitest";
import {
  SiteUnreachableError,
  checkJobHealth,
  needsAttention,
} from "@/lib/health-check";
import { closeBrowser, scanSite } from "@/lib/scanner";
import type { ScanJob, ToolHealth } from "@/lib/types";

/**
 * The failure this exists to catch is silent: a site is redesigned, the
 * selectors captured at scan time stop matching, and the embed answers
 * "not found" to an agent nobody is watching. So the tests here scan a site,
 * change it underneath, and check that the difference is reported — and,
 * just as important, that nothing else is reported along with it.
 */

/** A fixture whose markup can be swapped between scan and check. */
function mutableSite() {
  let body = "";
  let server: http.Server;
  const api = {
    serve(html: string) {
      body = html;
    },
    url: "",
    async start() {
      server = http.createServer((req, res) => {
        if (req.url === "/robots.txt") {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(body);
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve())
      );
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("bind failed");
      api.url = `http://127.0.0.1:${address.port}`;
    },
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    },
  };
  return api;
}

const WITH_FORM = `<!doctype html><title>Shop</title>
<nav><a href="/catalog">Catalog</a><a href="/about">About</a></nav>
<form name="contact" action="/send" method="post">
  <label for="e">Email</label><input id="e" name="email">
  <label for="m">Message</label><textarea id="m" name="message"></textarea>
</form>
<button type="button">Add to cart</button>
<button type="button">Checkout</button>`;

const REDESIGNED_NO_FORM = `<!doctype html><title>Shop</title>
<nav><a href="/catalog">Catalog</a><a href="/about">About</a></nav>
<p>Contact us at hello@example.test instead.</p>
<button type="button">Add to cart</button>
<button type="button">Checkout</button>`;

const REDESIGNED_FEWER_BUTTONS = `<!doctype html><title>Shop</title>
<nav><a href="/catalog">Catalog</a></nav>
<form name="contact" action="/send" method="post">
  <label for="e">Email</label><input id="e" name="email">
  <label for="m">Message</label><textarea id="m" name="message"></textarea>
</form>
<button type="button">Add to cart</button>`;

function jobFrom(scan: Awaited<ReturnType<typeof scanSite>>): ScanJob {
  return {
    id: "job_healthcheck001",
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

const byName = (tools: ToolHealth[], predicate: (t: ToolHealth) => boolean) =>
  tools.find(predicate);

describe("checking a job against the live site", () => {
  afterAll(async () => {
    await closeBrowser();
  });

  it("says everything is fine when nothing has changed", async () => {
    const site = mutableSite();
    site.serve(WITH_FORM);
    await site.start();
    try {
      const scan = await scanSite(`${site.url}/`);
      const report = await checkJobHealth(jobFrom(scan));

      expect(report.pagesFailed).toBe(0);
      expect(report.pagesChecked).toBeGreaterThan(0);
      // The point of this one is the absence of noise. A checker that cries
      // wolf on an unchanged site is worse than none, because the first real
      // warning arrives among a dozen false ones.
      const complaints = report.tools.filter((t) => t.status !== "ok");
      expect(complaints, JSON.stringify(complaints)).toHaveLength(0);
      expect(needsAttention(report)).toBe(false);
    } finally {
      await site.close();
    }
  });

  it("reports the form tool as missing after the form is taken off the page", async () => {
    const site = mutableSite();
    site.serve(WITH_FORM);
    await site.start();
    try {
      const scan = await scanSite(`${site.url}/`);
      const job = jobFrom(scan);
      expect(
        scan.candidates.some((c) => c.kind === "fill_form"),
        "the fixture should have produced a form tool to break"
      ).toBe(true);

      // The redesign: same site, same URL, no form.
      site.serve(REDESIGNED_NO_FORM);
      const report = await checkJobHealth(job);

      const form = byName(report.tools, (t) => t.kind === "fill_form");
      expect(form?.status).toBe("missing");
      expect(form?.detail).toMatch(/matches nothing/i);

      // And only that one. The tools that read the document as it stands have
      // no selector to lose.
      const info = byName(report.tools, (t) => t.kind === "get_page_info");
      expect(info?.status).toBe("ok");
      expect(needsAttention(report)).toBe(true);
    } finally {
      await site.close();
    }
  });

  it("calls a partly-emptied list degraded rather than dead", async () => {
    const site = mutableSite();
    site.serve(WITH_FORM);
    await site.start();
    try {
      const scan = await scanSite(`${site.url}/`);
      const job = jobFrom(scan);

      // "Checkout" and the About link are gone; the rest remain.
      site.serve(REDESIGNED_FEWER_BUTTONS);
      const report = await checkJobHealth(job);

      const click = byName(report.tools, (t) => t.kind === "click_by_text");
      expect(click?.status, "some labels remain, so this is not dead").toBe(
        "degraded"
      );
      expect(click?.detail).toMatch(/of \d+ labels are gone/);

      const open = byName(report.tools, (t) => t.kind === "open_path");
      expect(open?.status).toBe("degraded");
      expect(open?.detail).toMatch(/no longer linked/);
    } finally {
      await site.close();
    }
  });

  it("refuses to judge anything when the site will not open at all", async () => {
    const site = mutableSite();
    site.serve(WITH_FORM);
    await site.start();
    const scan = await scanSite(`${site.url}/`);
    const job = jobFrom(scan);
    // The site goes away entirely — a host that moved, a certificate that
    // expired, an outage.
    await site.close();

    // Reporting every selector as missing here would tell an owner their tools
    // are dead when their site was merely down. That false alarm is what
    // teaches people to ignore the real one, so there is no report at all.
    await expect(checkJobHealth(job)).rejects.toBeInstanceOf(
      SiteUnreachableError
    );
  });

  it("marks a negative result as provisional when a page would not open", async () => {
    const reachable = mutableSite();
    reachable.serve(WITH_FORM);
    await reachable.start();
    const gone = mutableSite();
    gone.serve(WITH_FORM);
    await gone.start();
    try {
      const scan = await scanSite(`${reachable.url}/`);
      const job = jobFrom(scan);
      // A second page the scan saw, which is unreachable by the time of the
      // check. The tool it held could be alive; nothing here can tell.
      job.pages = [
        ...scan.pages,
        { ...scan.pages[0], url: `${gone.url}/` },
      ];
      await gone.close();
      reachable.serve(REDESIGNED_NO_FORM);

      const report = await checkJobHealth(job);
      expect(report.pagesFailed).toBeGreaterThan(0);
      const form = byName(report.tools, (t) => t.kind === "fill_form");
      expect(form?.status).toBe("missing");
      expect(
        form?.detail,
        "a verdict reached on partial evidence has to say so"
      ).toMatch(/some pages could not be opened/);
    } finally {
      await reachable.close();
    }
  });
});
