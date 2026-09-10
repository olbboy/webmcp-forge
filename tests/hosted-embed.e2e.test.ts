import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";
import { POST as generatePost } from "@/app/api/jobs/[id]/generate/route";
import { POST as unpublishPost } from "@/app/api/jobs/[id]/unpublish/route";
import { POST as scanPost } from "@/app/api/scan/route";
import { closeBrowser, getBrowser } from "@/lib/scanner";
import type { ScanJob } from "@/lib/types";
import { startFixtureServer } from "./helpers";

/**
 * The whole promise of hosted embeds in one test: scan a site, generate, and
 * have a browser load the resulting script from the CDN by URL — the same way
 * a visitor's browser would — then confirm the tools are really registered.
 *
 * Every other suite stubs one side or the other. This one runs the real
 * Worker on workerd, the real Forge routes, and a real browser, so a break in
 * the contract between them cannot hide.
 */

const PUBLISH_TOKEN = "e2e-publish-token";

let harness: ReturnType<typeof createTestHarness> | undefined;
let fixture: Awaited<ReturnType<typeof startFixtureServer>> | undefined;

type GenerateResponse = {
  publicId?: string;
  publishStatus?: string;
  version?: number;
  publishError?: string;
  hostedEmbedUrl?: string;
  hostedManifestUrl?: string;
};

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("hosted embed, end to end", () => {
  beforeAll(async () => {
    harness = createTestHarness({
      workers: [
        {
          config: {
            name: "webmcp-forge-cdn-e2e",
            main: "cdn/src/index.ts",
            compatibility_date: "2026-09-01",
            kv_namespaces: [{ binding: "EMBEDS", id: "e2e-embeds" }],
            vars: { PUBLISH_TOKEN },
          },
        },
      ],
    });
    // Forge reaches the Worker over real HTTP here, not through the harness
    // dispatch helper, because that is what it will do in production.
    // `listen()` resolves to `{ url }` where url is a URL object, and its href
    // carries a trailing slash that the client would otherwise double up.
    const { url } = await harness.listen();
    process.env.CDN_BASE_URL = url.href.replace(/\/+$/, "");
    process.env.CDN_PUBLISH_TOKEN = PUBLISH_TOKEN;

    fixture = await startFixtureServer();
  });

  afterAll(async () => {
    delete process.env.CDN_BASE_URL;
    delete process.env.CDN_PUBLISH_TOKEN;
    await closeBrowser();
    await fixture?.close();
    await harness?.close();
  });

  it("publishes on generate, and a browser registers the tools from the CDN", async () => {
    const shopUrl = `${fixture!.url}/index.html`;

    const scanRes = await scanPost(
      new Request("http://127.0.0.1/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: shopUrl }),
      })
    );
    expect(scanRes.ok).toBe(true);
    const job = (await scanRes.json()) as ScanJob;
    expect(job.candidates.length).toBeGreaterThan(0);

    const genRes = await generatePost(
      new Request(`http://127.0.0.1/api/jobs/${job.id}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ includeLocalRelay: false }),
      }),
      params(job.id)
    );
    expect(genRes.ok).toBe(true);
    const generated = (await genRes.json()) as GenerateResponse;

    // Surfaces the reason instead of a bare "failed" when the CDN call breaks.
    expect(generated.publishError ?? generated.publishStatus).toBe("published");
    expect(generated.version).toBe(1);
    expect(generated.publicId).toMatch(/^pub_[a-f0-9]{32}$/);
    // The admin key must never appear in a URL that goes into a public page.
    expect(generated.hostedEmbedUrl).toContain(generated.publicId);
    expect(generated.hostedEmbedUrl).not.toContain(job.id);

    const hostedUrl = generated.hostedEmbedUrl as string;
    const hosted = await fetch(hostedUrl);
    expect(hosted.status).toBe(200);
    expect(hosted.headers.get("content-type")).toContain(
      "application/javascript"
    );
    expect(hosted.headers.get("etag")).toBe('"1"');
    expect(hosted.headers.get("cache-control")).toContain("max-age=300");

    const manifest = await fetch(generated.hostedManifestUrl as string);
    expect(manifest.status).toBe(200);
    expect(((await manifest.json()) as { version: string }).version).toBe("1");

    const browser = await getBrowser();
    const page = await browser.newPage();
    const logs: string[] = [];
    page.on("console", (msg) => logs.push(msg.text()));
    try {
      await page.goto(shopUrl, { waitUntil: "domcontentloaded" });
      // By URL, not by content: this is the one assertion that proves a site
      // owner only needs the script tag.
      await page.addScriptTag({ url: hostedUrl });
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

      const registered = await page.evaluate(async () => {
        const ctx = document.modelContext || navigator.modelContext;
        if (!ctx) throw new Error("modelContext missing");
        return (await ctx.getTools()).map((t) => t.name);
      });
      expect(registered).toContain("get_page_info");
      expect(registered).toContain("list_products");
      expect(logs.some((l) => l.includes("[WebMCP Forge] registered:"))).toBe(
        true
      );
    } finally {
      await page.close();
    }

    const unpublished = await unpublishPost(
      new Request(`http://127.0.0.1/api/jobs/${job.id}/unpublish`, {
        method: "POST",
      }),
      params(job.id)
    );
    expect(unpublished.ok).toBe(true);

    // Straight to the Worker, so no cache can mask a bundle that is still up.
    expect((await fetch(hostedUrl, { cache: "no-store" })).status).toBe(404);
  });
});
