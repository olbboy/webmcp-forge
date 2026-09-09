import type {
  ButtonHit,
  FilterControl,
  FormField,
  PageSnapshot,
  ProductCard,
  ScannedForm,
  ScannedLink,
  SearchInput,
} from "./types";

/**
 * Runs inside the page via Playwright. Must stay closure-free so evaluate() can serialize it.
 */
export function extractSnapshotInPage(): Omit<PageSnapshot, "url"> {
  const cssEscape = (value: string) => {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  };

  const isUnstableId = (id: string) => {
    if (!id) return true;
    if (id.includes(":")) return true;
    return /^(ember\d+|mui-\d+|react-aria-|radix-|[:a-z]*r[\d]+|[\da-f]{8,})$/i.test(
      id
    );
  };

  const semanticClass = (el: Element) => {
    const list = Array.from(el.classList);
    return list.find(
      (c) =>
        c.length > 2 &&
        c.length < 48 &&
        !/^[a-z]{1,3}\d/.test(c) &&
        /^(search|product|nav|form|btn|button|card|filter|contact|calc|catalog|newsletter)/i.test(
          c
        )
    );
  };

  const selectorFor = (el: Element | null): string => {
    if (!el || !(el instanceof Element)) return "";
    const tag = el.tagName.toLowerCase();
    const aria = el.getAttribute("aria-label");
    if (aria) return `${tag}[aria-label="${cssEscape(aria)}"]`;
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return `${tag}[placeholder="${cssEscape(placeholder)}"]`;
    const name = el.getAttribute("name");
    if (name) return `${tag}[name="${cssEscape(name)}"]`;
    const testid =
      el.getAttribute("data-testid") || el.getAttribute("data-test");
    if (testid) return `[data-testid="${cssEscape(testid)}"]`;
    const id = el.getAttribute("id");
    if (id && !isUnstableId(id)) return `#${cssEscape(id)}`;
    const role = el.getAttribute("role");
    if (role) return `${tag}[role="${cssEscape(role)}"]`;
    const cls = semanticClass(el);
    if (cls) return `${tag}.${cssEscape(cls)}`;
    const type = el.getAttribute("type");
    if (type && (tag === "input" || tag === "button")) {
      return `${tag}[type="${cssEscape(type)}"]`;
    }
    const parent = el.parentElement;
    if (parent) {
      const parentSel = selectorFor(parent);
      if (parentSel) {
        const same = Array.from(parent.children).filter(
          (c) => c.tagName === el.tagName
        );
        const idx = same.indexOf(el) + 1;
        return `${parentSel} > ${tag}:nth-of-type(${idx})`;
      }
    }
    return tag;
  };

  const absUrl = (href: string) => {
    try {
      return new URL(href, location.href).href;
    } catch {
      return href;
    }
  };

  const toLink = (a: HTMLAnchorElement): ScannedLink => {
    const href = absUrl(a.getAttribute("href") || a.href || "");
    let path = "";
    let sameOrigin = false;
    try {
      const u = new URL(href);
      path = u.pathname;
      sameOrigin = u.origin === location.origin;
    } catch {
      /* ignore */
    }
    return {
      href,
      text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120),
      path,
      sameOrigin,
    };
  };

  const labelFor = (input: Element): string => {
    const id = input.getAttribute("id");
    if (id) {
      const lab = document.querySelector(`label[for="${cssEscape(id)}"]`);
      if (lab) return (lab.textContent || "").replace(/\s+/g, " ").trim();
    }
    const parent = input.closest("label");
    if (parent) return (parent.textContent || "").replace(/\s+/g, " ").trim();
    return (
      input.getAttribute("aria-label") ||
      input.getAttribute("placeholder") ||
      input.getAttribute("name") ||
      ""
    );
  };

  const headingEls = Array.from(document.querySelectorAll("h1, h2, h3"));
  const headings = headingEls
    .map((h) => (h.textContent || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 30);

  const navRoot =
    document.querySelector("nav, [role='navigation'], header") || document.body;
  const navLinks = Array.from(navRoot.querySelectorAll("a[href]"))
    .map((a) => toLink(a as HTMLAnchorElement))
    .filter((l) => l.href && !l.href.startsWith("javascript:"))
    .slice(0, 40);

  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => toLink(a as HTMLAnchorElement))
    .filter((l) => l.href && !l.href.startsWith("javascript:"))
    .slice(0, 80);

  const searchInputs: SearchInput[] = [];
  const searchNodes = document.querySelectorAll(
    'input[type="search"], input[name*="search" i], input[placeholder*="search" i], input[aria-label*="search" i], [role="search"] input'
  );
  searchNodes.forEach((el) => {
    const input = el as HTMLInputElement;
    searchInputs.push({
      selector: selectorFor(input),
      placeholder: input.placeholder || undefined,
      name: input.name || undefined,
      ariaLabel: input.getAttribute("aria-label") || undefined,
    });
  });

  const forms: ScannedForm[] = [];
  document.querySelectorAll("form").forEach((form, index) => {
    const fields: FormField[] = [];
    form
      .querySelectorAll("input, select, textarea")
      .forEach((raw) => {
        const el = raw as HTMLInputElement;
        const type = (el.getAttribute("type") || el.tagName.toLowerCase()).toLowerCase();
        if (type === "hidden" || type === "submit" || type === "button") return;
        const name = el.getAttribute("name") || el.id || `field_${fields.length}`;
        fields.push({
          name,
          type,
          placeholder: el.getAttribute("placeholder") || undefined,
          label: labelFor(el) || undefined,
          required: el.hasAttribute("required"),
          selector: selectorFor(el),
        });
      });
    const action = form.getAttribute("action") || undefined;
    const ariaLabel = form.getAttribute("aria-label") || undefined;
    const name = form.getAttribute("name") || undefined;
    const blob = `${ariaLabel || ""} ${name || ""} ${action || ""} ${(form.textContent || "").slice(0, 200)}`.toLowerCase();
    const isSearch =
      form.getAttribute("role") === "search" ||
      /search/.test(blob) ||
      fields.some((f) => f.type === "search" || /search/i.test(f.name));
    const isContact =
      name === "contact" ||
      /\bcontact\b/i.test(blob) ||
      Boolean(ariaLabel && /contact/i.test(ariaLabel));
    const isCalculator =
      /calculat|estimator|quote/.test(blob) ||
      (fields.filter((f) => f.type === "number").length >= 2 &&
        /calc|total|estimate/i.test(form.className + (ariaLabel || "")));
    forms.push({
      id: `${name || ariaLabel || "form"}_${index}`,
      action,
      method: (form.getAttribute("method") || "get").toLowerCase(),
      selector: selectorFor(form),
      name,
      ariaLabel,
      fields,
      isSearch,
      isContact,
      isCalculator,
    });
  });

  const buttons: ButtonHit[] = [];
  document
    .querySelectorAll(
      'button, [role="button"], input[type="submit"], input[type="button"]'
    )
    .forEach((el) => {
      const text = (
        (el as HTMLInputElement).value ||
        el.textContent ||
        el.getAttribute("aria-label") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
      if (!text) return;
      buttons.push({
        text: text.slice(0, 80),
        selector: selectorFor(el),
        ariaLabel: el.getAttribute("aria-label") || undefined,
        type: el.getAttribute("type") || undefined,
      });
    });

  const products: ProductCard[] = [];
  const productNodes = Array.from(
    document.querySelectorAll(
      '[itemtype*="Product"], [data-product], .product-card, .product-item, [class*="product-card"], [class*="product-item"]'
    )
  );

  const pushProduct = (card: Element) => {
    const titleEl =
      card.querySelector("h2, h3, .product-title, [itemprop='name']") || card;
    const title = (titleEl.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    if (!title) return;
    const priceEl = card.querySelector(
      ".price, [itemprop='price'], [data-price], .product-price"
    );
    const link = card.querySelector("a[href]") as HTMLAnchorElement | null;
    products.push({
      title,
      price: priceEl
        ? (priceEl.textContent || "").replace(/\s+/g, " ").trim()
        : undefined,
      href: link ? absUrl(link.getAttribute("href") || link.href) : undefined,
      selector: selectorFor(card),
    });
  };

  productNodes.forEach(pushProduct);

  if (products.length === 0) {
    const lists = document.querySelectorAll(
      "ul, ol, [role='list'], .grid, .products, [class*='catalog']"
    );
    lists.forEach((list) => {
      const children = Array.from(list.children);
      if (children.length < 2) return;
      const priced = children.filter((c) =>
        /\$|€|£|₫|VND|\d+[.,]\d{2}/.test(c.textContent || "")
      );
      if (priced.length >= 2) priced.forEach(pushProduct);
    });
  }

  const filters: FilterControl[] = [];
  const filterRoot = document.querySelector(
    "[data-filters], aside, .filters, [aria-label*='filter' i]"
  );
  const filterScope = filterRoot || document;
  filterScope.querySelectorAll("select, input[type='checkbox'], input[type='radio']").forEach(
    (el) => {
      if (!filterRoot && !/filter|category|sort/i.test(el.outerHTML + labelFor(el))) {
        return;
      }
      const kind = (
        el.tagName === "SELECT"
          ? "select"
          : (el as HTMLInputElement).type === "radio"
            ? "radio"
            : "checkbox"
      ) as FilterControl["kind"];
      filters.push({
        selector: selectorFor(el),
        label: labelFor(el) || el.getAttribute("name") || "filter",
        kind,
      });
    }
  );

  const description =
    document.querySelector('meta[name="description"]')?.getAttribute("content") ||
    undefined;

  return {
    title: document.title || "",
    description,
    headings,
    navLinks,
    links,
    forms,
    buttons: buttons.slice(0, 40),
    searchInputs,
    products: products.slice(0, 40),
    filters: filters.slice(0, 20),
  };
}
