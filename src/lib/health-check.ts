import { MAX_PAGES, PAGE_TIMEOUT_MS, USER_AGENT } from "./config";
import { assertScannableUrl } from "./net-guard";
import {
  assertConnectionWasPublic,
  getBrowser,
  parseScanUrl,
} from "./scanner";
import type { HealthReport, ScanJob, ToolCandidate, ToolHealth } from "./types";

/**
 * Re-opens a site and reports which of its tools can still find what they act
 * on.
 *
 * The tools carry CSS selectors captured when the site was scanned. A redesign
 * invalidates them, and nothing says so: the embed answers
 * `{ok: false, error: "Form not found"}` to an agent nobody is watching, and
 * the site owner finds out when a customer mentions it. This turns that into
 * something that can be looked at, and nothing more — it does not repair a
 * tool or re-scan a site, because both of those change what a customer already
 * approved.
 */

/** Not one page would open, so the check has no opinion to offer. */
export class SiteUnreachableError extends Error {
  constructor(readonly pagesFailed: number) {
    super(
      `None of the ${pagesFailed} page(s) recorded for this job could be opened, so nothing was checked.`
    );
    this.name = "SiteUnreachableError";
  }
}

/** What a single page reported back about the selectors it was asked about. */
type PageProbe = {
  matchedToolIds: string[];
  labelsFound: string[];
  pathsFound: string[];
};

/** The question put to one page: which of these can you still find? */
type Probe = {
  selectorsByToolId: Array<{ id: string; selectors: string[] }>;
  labels: string[];
  paths: string[];
};

/**
 * Runs inside the page. Closure-free so `evaluate` can serialize it, and
 * deliberately incurious: it answers what is present and reads nothing else,
 * so a health check cannot become a second way to pull content off a site.
 */
function probeInPage(probe: Probe): PageProbe {
  const matchedToolIds: string[] = [];
  for (const entry of probe.selectorsByToolId) {
    const found = entry.selectors.some((selector) => {
      if (!selector) return false;
      try {
        return document.querySelector(selector) !== null;
      } catch {
        // An invalid selector is the tool's problem, not this page's, and it
        // can never match anything.
        return false;
      }
    });
    if (found) matchedToolIds.push(entry.id);
  }

  const normalise = (value: string) =>
    value.replace(/\s+/g, " ").trim().toLowerCase();

  const present = new Set<string>();
  document
    .querySelectorAll(
      'a, button, [role="button"], input[type="submit"], input[type="button"]'
    )
    .forEach((element) => {
      const input = element as HTMLInputElement;
      const text =
        input.value || element.textContent || element.getAttribute("aria-label") || "";
      const label = normalise(text);
      if (label) present.add(label);
    });
  const labelsFound = probe.labels.filter((label) => present.has(normalise(label)));

  const linked = new Set<string>();
  document.querySelectorAll("a[href]").forEach((anchor) => {
    try {
      linked.add(new URL((anchor as HTMLAnchorElement).href).pathname);
    } catch {
      /* not a URL we can compare */
    }
  });
  const pathsFound = probe.paths.filter((path) => linked.has(path));

  return { matchedToolIds, labelsFound, pathsFound };
}

/** The CSS selectors a tool depends on, flattened. */
function selectorsOf(tool: ToolCandidate): string[] {
  if (!tool.selectors) return [];
  return Object.values(tool.selectors).flatMap((value) =>
    Array.isArray(value) ? value : [value]
  );
}

function allowlistOf(tool: ToolCandidate): string[] {
  const list = tool.metadata?.allowlist;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Which pages to look at.
 *
 * The same ones the scan recorded, because a tool is alive if its target is on
 * any page a visitor might be standing on — that is exactly how the embed
 * behaves, trying each selector in turn. Checking only the home page would
 * report a contact form as dead because it lives on /contact.
 */
function pagesToCheck(job: ScanJob): string[] {
  const recorded = (job.pages ?? [])
    .filter((page) => !page.error && page.url)
    .map((page) => page.url);
  const urls = recorded.length > 0 ? recorded : [job.url];
  return [...new Set(urls)].slice(0, MAX_PAGES);
}

function verdictFor(
  tool: ToolCandidate,
  found: Set<string>,
  labelsFound: Set<string>,
  pathsFound: Set<string>,
  incomplete: boolean
): ToolHealth {
  const base = { id: tool.id, name: tool.name, kind: tool.kind };
  // A page that would not open might have been the one holding this selector,
  // so a negative result is worth less than usual and should say so.
  const caveat = incomplete ? " — some pages could not be opened" : "";

  const labels = allowlistOf(tool);
  if (tool.kind === "click_by_text" && labels.length > 0) {
    const alive = labels.filter((label) => labelsFound.has(label)).length;
    if (alive === 0) {
      return { ...base, status: "missing", detail: `none of ${labels.length} labels are on the site any more${caveat}` };
    }
    if (alive < labels.length) {
      return { ...base, status: "degraded", detail: `${labels.length - alive} of ${labels.length} labels are gone` };
    }
    return { ...base, status: "ok", detail: `all ${labels.length} labels still present` };
  }

  if (tool.kind === "open_path" && labels.length > 0) {
    const alive = labels.filter((path) => pathsFound.has(path)).length;
    if (alive === 0) {
      return { ...base, status: "missing", detail: `none of ${labels.length} paths are linked any more${caveat}` };
    }
    if (alive < labels.length) {
      return { ...base, status: "degraded", detail: `${labels.length - alive} of ${labels.length} paths are no longer linked` };
    }
    return { ...base, status: "ok", detail: `all ${labels.length} paths still linked` };
  }

  const selectors = selectorsOf(tool);
  if (selectors.length === 0) {
    // Reads the document as it stands — title, headings, every anchor — so
    // there is no selector here to go stale.
    return { ...base, status: "ok", detail: "no selector to break" };
  }

  return found.has(tool.id)
    ? { ...base, status: "ok" }
    : {
        ...base,
        status: "missing",
        detail: `its selector matches nothing on any scanned page${caveat}`,
      };
}

/**
 * Checks one job's tools against the live site.
 *
 * Goes through the same two guards a scan does. The addresses came from a scan
 * that passed them once, but a site can be redirected into the private network
 * afterwards, and a check that skipped the guards would be a way back in.
 */
export async function checkJobHealth(
  job: ScanJob,
  selfOrigin?: string
): Promise<HealthReport> {
  const tools = job.candidates ?? [];
  const probe: Probe = {
    selectorsByToolId: tools
      .map((tool) => ({ id: tool.id, selectors: selectorsOf(tool) }))
      .filter((entry) => entry.selectors.length > 0),
    labels: [
      ...new Set(
        tools.filter((t) => t.kind === "click_by_text").flatMap(allowlistOf)
      ),
    ],
    paths: [
      ...new Set(tools.filter((t) => t.kind === "open_path").flatMap(allowlistOf)),
    ],
  };

  const matched = new Set<string>();
  const labelsFound = new Set<string>();
  const pathsFound = new Set<string>();
  let pagesChecked = 0;
  let pagesFailed = 0;

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
  });
  context.setDefaultTimeout(PAGE_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);

  try {
    for (const href of pagesToCheck(job)) {
      const page = await context.newPage();
      try {
        await assertScannableUrl(parseScanUrl(href), { selfOrigin });
        const response = await page.goto(href, {
          waitUntil: "domcontentloaded",
          timeout: PAGE_TIMEOUT_MS,
        });
        await assertConnectionWasPublic(page, response, selfOrigin);
        const result = await page.evaluate(probeInPage, probe);
        for (const id of result.matchedToolIds) matched.add(id);
        for (const label of result.labelsFound) labelsFound.add(label);
        for (const path of result.pathsFound) pathsFound.add(path);
        pagesChecked += 1;
      } catch {
        // A page that will not open cannot vouch for anything, and one of them
        // is not a reason to abandon the rest. It is counted so the report can
        // say the picture is incomplete.
        pagesFailed += 1;
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
  }

  // Nothing was seen, so nothing can be said. Reporting every selector as
  // missing here would tell an owner their tools are dead when the truth is
  // their site was unreachable for a minute — the false alarm that teaches
  // people to ignore the real one.
  if (pagesChecked === 0) {
    throw new SiteUnreachableError(pagesFailed);
  }

  return {
    checkedAt: new Date().toISOString(),
    pagesChecked,
    pagesFailed,
    tools: tools.map((tool) =>
      verdictFor(tool, matched, labelsFound, pathsFound, pagesFailed > 0)
    ),
  };
}

/** True when the report found something an owner should act on. */
export function needsAttention(report: HealthReport): boolean {
  return report.tools.some((tool) => tool.status !== "ok");
}
