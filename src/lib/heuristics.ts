import { sanitizeToolName } from "./names";
import type {
  JsonSchema,
  PageSnapshot,
  ScannedForm,
  ToolCandidate,
} from "./types";

const emptySchema = (): JsonSchema => ({
  type: "object",
  properties: {},
});

export function proposeTools(
  pages: PageSnapshot[],
  origin: string
): ToolCandidate[] {
  const used = new Set<string>();
  const tools: ToolCandidate[] = [];

  const home = pages[0];
  const allNav = dedupeLinks(pages.flatMap((p) => p.navLinks));
  const allLinks = dedupeLinks(pages.flatMap((p) => p.links));
  const allProducts = pages.flatMap((p) => p.products);
  const allSearch = pages.flatMap((p) => p.searchInputs);
  const allForms = dedupeForms(pages.flatMap((p) => p.forms));
  const allowlist = uniquePaths(
    allNav.filter((l) => l.sameOrigin).map((l) => l.path)
  );

  tools.push({
    id: "get_page_info",
    name: sanitizeToolName("get_page_info", used),
    description:
      "Read the current page title, URL, meta description, and visible headings. Runs in the visitor's open tab.",
    kind: "get_page_info",
    enabled: true,
    inputSchema: emptySchema(),
    source: home?.url,
    metadata: { annotations: { readOnlyHint: true } },
  });

  if (allNav.length > 0) {
    tools.push({
      id: "get_site_nav",
      name: sanitizeToolName("get_site_nav", used),
      description:
        "List primary navigation links from the live DOM (nav / header / role=navigation).",
      kind: "get_site_nav",
      enabled: true,
      inputSchema: emptySchema(),
      selectors: {
        nav: "nav a[href], [role='navigation'] a[href], header a[href]",
      },
      source: home?.url,
      metadata: { annotations: { readOnlyHint: true } },
    });
  }

  if (allLinks.length > 0) {
    tools.push({
      id: "list_links",
      name: sanitizeToolName("list_links", used),
      description: "List hyperlinks on the current page, including same-origin URLs.",
      kind: "list_links",
      enabled: true,
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of links to return (default 80).",
          },
        },
      },
      source: home?.url,
      metadata: { annotations: { readOnlyHint: true } },
    });
  }

  if (allProducts.length > 0) {
    const productSelectors = unique(
      allProducts.map((p) => p.selector).filter(Boolean)
    );
    tools.push({
      id: "list_products",
      name: sanitizeToolName("list_products", used),
      description: `List product cards currently in the DOM (${allProducts.length} detected during scan).`,
      kind: "list_products",
      enabled: true,
      inputSchema: emptySchema(),
      selectors: {
        product:
          productSelectors.length > 0
            ? productSelectors
            : [
                ".product-card",
                "[data-product]",
                "[itemtype*='Product']",
                ".product-item",
              ],
      },
      source: home?.url,
      metadata: {
        annotations: { readOnlyHint: true },
        sampleTitles: allProducts.slice(0, 5).map((p) => p.title),
      },
    });
  }

  if (allSearch.length > 0) {
    const search = allSearch[0];
    tools.push({
      id: "search_on_page",
      name: sanitizeToolName("search_on_page", used),
      description:
        "Fill the on-page search box. Does not submit unless submit=true. Uses the visitor's current session.",
      kind: "search_on_page",
      enabled: true,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          submit: {
            type: "boolean",
            description: "If true, submit the search form. Default false.",
          },
        },
        required: ["query"],
      },
      selectors: { search: search.selector },
      source: home?.url,
    });
  }

  for (const form of allForms) {
    if (form.isSearch && form.fields.length <= 2) continue;
    const slug = form.isContact
      ? "contact"
      : form.isCalculator
        ? "calculator"
        : form.name || form.ariaLabel || form.id || "form";
    const name = sanitizeToolName(`fill_form_${slug}`, used);
    const fieldNames = form.fields.map((f) => f.name);
    const fieldProps: Record<string, unknown> = {};
    for (const f of form.fields) {
      fieldProps[f.name] = {
        type: f.type === "number" ? "number" : "string",
        description: f.label || f.placeholder || f.name,
      };
    }
    tools.push({
      id: name,
      name,
      description: formToolDescription(form),
      kind: "fill_form",
      enabled: true,
      inputSchema: {
        type: "object",
        properties: {
          fields: {
            type: "object",
            description: `Form fields: ${fieldNames.join(", ") || "(none)"}`,
            properties: fieldProps,
          },
          dryRun: {
            type: "boolean",
            description:
              "If true (default), fill fields but do not submit. Always default-safe.",
          },
          confirmSubmit: {
            type: "boolean",
            description:
              "Must be true together with dryRun=false to actually submit the form.",
          },
        },
      },
      selectors: { form: form.selector },
      metadata: {
        fields: form.fields,
        action: form.action,
        method: form.method,
      },
      source: home?.url,
    });
  }

  tools.push({
    id: "click_by_text",
    name: sanitizeToolName("click_by_text", used),
    description:
      "Click a button or link whose visible text or aria-label matches the given string.",
    kind: "click_by_text",
    enabled: true,
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "Visible text or aria-label to match (case-insensitive).",
        },
      },
      required: ["text"],
    },
    source: home?.url,
  });

  if (allowlist.length > 0) {
    tools.push({
      id: "open_path",
      name: sanitizeToolName("open_path", used),
      description: `Navigate to an allowlisted same-origin path from site navigation. Allowed: ${allowlist.join(", ")}`,
      kind: "open_path",
      enabled: true,
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Same-origin path to open.",
            enum: allowlist,
          },
        },
        required: ["path"],
      },
      metadata: { allowlist, origin },
      source: home?.url,
    });
  }

  return tools;
}

function formToolDescription(form: ScannedForm): string {
  const names = form.fields.map((f) => f.name).join(", ");
  const kind = form.isContact
    ? "contact form"
    : form.isCalculator
      ? "calculator form"
      : "form";
  return `Fill the ${kind}${form.ariaLabel ? ` "${form.ariaLabel}"` : ""} (${names || "no named fields"}). Never submits unless dryRun=false and confirmSubmit=true.`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniquePaths(paths: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    if (!p || p.startsWith("mailto:") || p.startsWith("tel:")) continue;
    const norm = p === "" ? "/" : p;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out.slice(0, 24);
}

function dedupeLinks<T extends { href: string }>(links: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const l of links) {
    if (!l.href || seen.has(l.href)) continue;
    seen.add(l.href);
    out.push(l);
  }
  return out;
}

function dedupeForms(forms: ScannedForm[]): ScannedForm[] {
  const seen = new Set<string>();
  const out: ScannedForm[] = [];
  for (const f of forms) {
    const key = `${f.selector}|${f.action || ""}|${f.fields.map((x) => x.name).join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
