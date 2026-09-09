import { afterAll, describe, expect, it } from "vitest";
import { closeBrowser, scanSite } from "@/lib/scanner";
import { startFixtureServer } from "./helpers";

describe("scanner against local fixture shop", () => {
  let fixture: { url: string; close: () => Promise<void> };

  afterAll(async () => {
    if (fixture) await fixture.close();
  });

  it("finds nav, search, forms, and product cards", async () => {
    fixture = await startFixtureServer();
    const result = await scanSite(`${fixture.url}/index.html`);

    expect(result.pages.length).toBeGreaterThanOrEqual(1);
    expect(result.pages.length).toBeLessThanOrEqual(8);
    const home = result.pages[0];
    expect(home.title).toMatch(/Harbor & Oak/i);
    expect(home.searchInputs.length).toBeGreaterThan(0);
    expect(home.products.length).toBeGreaterThanOrEqual(3);
    expect(home.forms.length).toBeGreaterThan(0);
    expect(home.navLinks.some((l) => /catalog/i.test(l.path + l.text))).toBe(
      true
    );

    const names = result.candidates.map((c) => c.name);
    expect(names).toContain("get_page_info");
    expect(names).toContain("get_site_nav");
    expect(names).toContain("list_products");
    expect(names).toContain("search_on_page");
    expect(names).toContain("click_by_text");
    expect(names).toContain("open_path");
    expect(names.some((n) => n.startsWith("fill_form_"))).toBe(true);
    expect(names.every((n) => /^[a-z][a-z0-9_]*$/.test(n))).toBe(true);

    const extraTitles = result.pages.map((p) => p.title).join(" ");
    expect(extraTitles).toMatch(/Catalog|About|Contact/i);
  });
});

afterAll(async () => {
  await closeBrowser();
});
