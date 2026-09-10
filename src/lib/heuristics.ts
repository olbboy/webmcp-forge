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
    metadata: { annotations: { readOnlyHint: true, untrustedContentHint: true } },
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
      metadata: { annotations: { readOnlyHint: true, untrustedContentHint: true } },
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
      metadata: { annotations: { readOnlyHint: true, untrustedContentHint: true } },
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
        annotations: { readOnlyHint: true, untrustedContentHint: true },
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

  for (const { form, selectors: formSelectors } of allForms) {
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
      // Every page the form was found on, tried in order by the embed.
      selectors: { form: formSelectors },
      metadata: {
        // The tool can submit, so it is flagged as consequential even though it
        // defaults to filling only. The hint describes what the tool is able to
        // do, not what a particular call asked for.
        annotations: { consequentialHint: true },
        fields: form.fields,
        action: form.action,
        method: form.method,
      },
      source: home?.url,
    });
  }

  const clickable = clickableAllowlist(pages);
  // No list means nothing this tool could legitimately press. Offering it
  // anyway leaves an agent guessing at strings that will all be refused.
  if (clickable.length > 0) {
    tools.push({
      id: "click_by_text",
      name: sanitizeToolName("click_by_text", used),
      description: `Click one of the buttons or links found on this site. Only these exact labels work: ${clickable.join(" | ")}`,
      kind: "click_by_text",
      enabled: true,
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description:
              "The exact label to click, from the allowed list (case-insensitive).",
            enum: clickable,
          },
        },
        required: ["text"],
      },
      metadata: {
        allowlist: clickable,
        annotations: {
          consequentialHint: true,
          // The labels above are text from the scanned site, and they travel
          // into the tool description an agent reads.
          untrustedContentHint: true,
        },
      },
      source: home?.url,
    });
  }

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
      metadata: {
        allowlist,
        origin,
        // Navigating away discards whatever the visitor had in progress.
        annotations: { consequentialHint: true },
      },
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

/** A form together with every place on the site it was found. */
type MergedForm = { form: ScannedForm; selectors: string[] };

/**
 * The same endpoint reached from two pages resolves to two different absolute
 * URLs, so the path is what identifies it.
 */
function actionPath(action: string | undefined): string {
  if (!action) return "";
  try {
    return new URL(action, "http://form.local").pathname;
  } catch {
    return action;
  }
}

/**
 * What a form does, ignoring where it sits. Method, endpoint, fields and the
 * intent flags describe the job; the CSS selector describes a position in one
 * document and belongs nowhere near this.
 */
function formIdentity(f: ScannedForm): string {
  const fields = f.fields
    .map((x) => `${x.name}:${x.type}`)
    .sort()
    .join(",");
  const intent = `${f.isSearch ? "s" : ""}${f.isContact ? "c" : ""}${f.isCalculator ? "k" : ""}`;
  return `${(f.method || "get").toLowerCase()}|${actionPath(f.action)}|${fields}|${intent}`;
}

/**
 * Collapses a form repeated across pages into one tool.
 *
 * The old key included the CSS selector, which is a position in a document, so
 * an add-to-cart form on eight product pages arrived as eight separate tools
 * with names like fill_form_form_2_2. Nothing was wrong with the pages; the
 * key was measuring the wrong thing.
 *
 * Every distinct selector is kept rather than discarded. The visitor could be
 * on any of those pages, and the embed tries each selector in turn, so a
 * merged tool works everywhere its form appears instead of only where it
 * happened to be seen first.
 */
function dedupeForms(forms: ScannedForm[]): MergedForm[] {
  const merged = new Map<string, MergedForm>();
  for (const form of forms) {
    const key = formIdentity(form);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { form, selectors: [form.selector] });
      continue;
    }
    if (!existing.selectors.includes(form.selector)) {
      existing.selectors.push(form.selector);
    }
  }
  return [...merged.values()];
}

/**
 * The labels `click_by_text` is allowed to press, gathered from what was on the
 * pages at scan time.
 *
 * Matching arbitrary text against the live page is how "delete" reaches "Delete
 * account". A fixed list cannot grow new entries after the fact, so the worst an
 * agent can do is press something the site already showed a visitor.
 */
export function clickableAllowlist(pages: PageSnapshot[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const page of pages) {
    // Older jobs were stored before this field existed.
    for (const button of page.buttons ?? []) {
      const label = (button.text || "").replace(/\s+/g, " ").trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label);
      if (out.length >= 40) return out;
    }
  }
  return out;
}
