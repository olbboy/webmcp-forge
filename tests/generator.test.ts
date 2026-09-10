import { afterAll, describe, expect, it } from "vitest";
import { buildManifest, generateEmbedJs } from "@/lib/generator";
import { closeBrowser, getBrowser, scanSite } from "@/lib/scanner";
import type { ScanJob } from "@/lib/types";
import { startFixtureServer, unwrapToolResult } from "./helpers";

describe("generated embed.js registers and executes tools", () => {
  afterAll(async () => {
    await closeBrowser();
  });

  it("injects into the fixture and getTools/executeTool work", async () => {
    const fixture = await startFixtureServer();
    try {
      const scan = await scanSite(`${fixture.url}/index.html`);
      const selected = scan.candidates.filter((c) =>
        ["get_page_info", "list_products", "search_on_page", "click_by_text"].includes(
          c.name
        )
      );
      expect(selected.length).toBeGreaterThanOrEqual(2);

      const job: ScanJob = {
        id: "job_testembed0001",
        url: scan.url,
        origin: scan.origin,
        status: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pages: scan.pages,
        candidates: scan.candidates,
        includeLocalRelay: false,
      };
      const js = generateEmbedJs(buildManifest(job, selected, false, 1, new Date().toISOString()));
      expect(js).toContain("document.modelContext");
      expect(js).toContain("navigator.modelContext");
      expect(js).toContain("[WebMCP Forge] registered:");

      const browser = await getBrowser();
      const page = await browser.newPage();
      const logs: string[] = [];
      page.on("console", (msg) => logs.push(msg.text()));
      await page.goto(`${fixture.url}/index.html`, {
        waitUntil: "domcontentloaded",
      });
      await page.addScriptTag({ content: js });
      await page.waitForFunction(
        () => Boolean((window as unknown as { __WEBMCP_FORGE_READY__?: Promise<unknown> }).__WEBMCP_FORGE_READY__)
      );
      await page.evaluate(() => (window as unknown as { __WEBMCP_FORGE_READY__: Promise<unknown> }).__WEBMCP_FORGE_READY__);

      const registered = await page.evaluate(async () => {
        const ctx = document.modelContext || navigator.modelContext;
        if (!ctx) throw new Error("modelContext missing");
        const tools = await ctx.getTools();
        return tools.map((t) => t.name);
      });
      expect(registered).toContain("get_page_info");
      expect(registered).toContain("list_products");
      expect(logs.some((l) => l.includes("[WebMCP Forge] registered:"))).toBe(
        true
      );

      const pageInfo = await page.evaluate(async () => {
        const ctx = document.modelContext;
        if (!ctx?.executeTool) throw new Error("executeTool missing");
        const tools = await ctx.getTools();
        const tool = tools.find((t) => t.name === "get_page_info");
        if (!tool) throw new Error("get_page_info missing");
        return ctx.executeTool(tool, "{}");
      });
      const info = unwrapToolResult(pageInfo);
      expect(String(info.title)).toMatch(/Harbor & Oak/i);
      expect(String(info.url)).toContain("index.html");
      expect(Array.isArray(info.headings)).toBe(true);

      const productsRaw = await page.evaluate(async () => {
        const ctx = document.modelContext;
        if (!ctx?.executeTool) throw new Error("executeTool missing");
        const tools = await ctx.getTools();
        const tool = tools.find((t) => t.name === "list_products");
        if (!tool) throw new Error("list_products missing");
        return ctx.executeTool(tool, "{}");
      });
      const products = unwrapToolResult(productsRaw);
      const titles = JSON.stringify(products);
      expect(titles).toMatch(/Oak Ridge Anorak/);
      expect(Number(products.count)).toBeGreaterThanOrEqual(3);

      await page.close();
    } finally {
      await fixture.close();
    }
  });

  it("registers when the tag runs while the document is still parsing", async () => {
    // Where the docs tell an owner to put the tag: before </body>, which means
    // it executes at readyState "loading" and has to wait for DOMContentLoaded
    // rather than reading the DOM straight away. Injected inline and
    // same-origin, because Chrome blocks a parse-time subresource request that
    // crosses loopback ports.
    const fixture = await startFixtureServer();
    try {
      const scan = await scanSite(`${fixture.url}/index.html`);
      const selected = scan.candidates.filter((c) =>
        ["get_page_info", "list_products"].includes(c.name)
      );
      const job: ScanJob = {
        id: "job_testparsetime01",
        url: scan.url,
        origin: scan.origin,
        status: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        pages: scan.pages,
        candidates: scan.candidates,
        includeLocalRelay: false,
      };
      const js = generateEmbedJs(
        buildManifest(job, selected, false, 1, new Date().toISOString())
      );

      const browser = await getBrowser();
      const page = await browser.newPage();
      const shopUrl = `${fixture.url}/index.html`;
      try {
        await page.route(shopUrl, async (route) => {
          const response = await route.fetch();
          const html = await response.text();
          await route.fulfill({
            response,
            body: html.replace("</body>", `<script>${js}</script></body>`),
          });
        });
        await page.goto(shopUrl, { waitUntil: "load" });

        const registered = await page.evaluate(async () => {
          const ready = (
            window as unknown as { __WEBMCP_FORGE_READY__?: Promise<unknown> }
          ).__WEBMCP_FORGE_READY__;
          if (!ready) throw new Error("embed did not boot");
          await ready;
          const ctx = document.modelContext || navigator.modelContext;
          if (!ctx) throw new Error("modelContext missing");
          return (await ctx.getTools()).map((t) => t.name);
        });
        expect(registered).toContain("get_page_info");
        expect(registered).toContain("list_products");
      } finally {
        await page.close();
      }
    } finally {
      await fixture.close();
    }
  });
});
