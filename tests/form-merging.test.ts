import { describe, expect, it } from "vitest";
import { proposeTools } from "@/lib/heuristics";
import type { FormField, PageSnapshot, ScannedForm } from "@/lib/types";

/**
 * A cart form repeated across eight product pages used to arrive as eight
 * tools, because the key that was meant to spot duplicates included the form's
 * position in the document. These pin the rule that replaced it: same job,
 * same tool, wherever it sits.
 */

function field(name: string, type = "text"): FormField {
  return { name, type, selector: `[name="${name}"]` };
}

function form(overrides: Partial<ScannedForm> = {}): ScannedForm {
  return {
    id: "form_0",
    selector: "form:nth-of-type(1)",
    action: "/cart/add",
    method: "post",
    fields: [field("quantity", "number"), field("variant")],
    ...overrides,
  };
}

function page(url: string, forms: ScannedForm[]): PageSnapshot {
  return {
    url,
    title: "Shop",
    headings: [],
    navLinks: [],
    links: [],
    forms,
    buttons: [],
    searchInputs: [],
    products: [],
    filters: [],
  };
}

function formTools(pages: PageSnapshot[]) {
  return proposeTools(pages, "https://shop.example").filter(
    (t) => t.kind === "fill_form"
  );
}

describe("merging forms that appear on more than one page", () => {
  it("makes one tool from the same form found on several pages", () => {
    // Same cart form, three product pages, three different positions.
    const pages = [
      page("https://shop.example/", [form({ selector: "form:nth-of-type(1)" })]),
      page("https://shop.example/a", [
        form({ selector: "main > form:nth-of-type(3)", id: "form_2" }),
      ]),
      page("https://shop.example/b", [
        form({ selector: "div > form:nth-of-type(2)", id: "form_1" }),
      ]),
    ];

    const tools = formTools(pages);
    expect(tools).toHaveLength(1);

    // Merging means keeping every place it was found, not picking one. A
    // visitor could be on any of these pages when the tool runs.
    expect(tools[0].selectors?.form).toEqual([
      "form:nth-of-type(1)",
      "main > form:nth-of-type(3)",
      "div > form:nth-of-type(2)",
    ]);
  });

  it("keeps forms apart when they take different fields", () => {
    const pages = [
      page("https://shop.example/", [
        form({ fields: [field("email")] }),
        form({
          selector: "form:nth-of-type(2)",
          fields: [field("name"), field("message")],
        }),
      ]),
    ];
    expect(formTools(pages)).toHaveLength(2);
  });

  it("keeps forms apart when they post to different places", () => {
    const pages = [
      page("https://shop.example/", [form({ action: "/cart/add" })]),
      page("https://shop.example/a", [
        form({ action: "/newsletter", selector: "form:nth-of-type(9)" }),
      ]),
    ];
    expect(formTools(pages)).toHaveLength(2);
  });

  it("treats one endpoint as one form however the page spelled it", () => {
    // Relative on one page, absolute on another: same endpoint either way.
    const pages = [
      page("https://shop.example/", [form({ action: "/cart/add" })]),
      page("https://shop.example/a", [
        form({
          action: "https://shop.example/cart/add",
          selector: "form:nth-of-type(4)",
        }),
      ]),
    ];
    expect(formTools(pages)).toHaveLength(1);
  });

  it("does not merge a contact form into a plain one that looks like it", () => {
    const pages = [
      page("https://shop.example/", [form({ isContact: true })]),
      page("https://shop.example/a", [
        form({ selector: "form:nth-of-type(7)" }),
      ]),
    ];
    // The intent changes the description and the name a site owner reads, so
    // collapsing them would hide one of them.
    expect(formTools(pages)).toHaveLength(2);
  });

  it("does not repeat a selector when the same page is scanned twice", () => {
    const pages = [
      page("https://shop.example/", [form()]),
      page("https://shop.example/", [form()]),
    ];
    const tools = formTools(pages);
    expect(tools).toHaveLength(1);
    expect(tools[0].selectors?.form).toEqual(["form:nth-of-type(1)"]);
  });
});
