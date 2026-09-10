import { chromium, type Browser, type Page, type Response } from "playwright";
import {
  BROWSER_IDLE_MS,
  DEFAULT_SCANNER_CDP_URL,
  DEFAULT_SCANNER_ENGINE,
  MAX_PAGES,
  PAGE_TIMEOUT_MS,
  ROBOTS_TIMEOUT_MS,
  SCAN_TIMEOUT_MS,
  USER_AGENT,
  type ScannerEngine,
} from "./config";
import { extractSnapshotInPage } from "./extract";
import { proposeTools } from "./heuristics";
import {
  ScanBlockedError,
  assertScannableIp,
  assertScannableUrl,
  enforceConnectedIp,
  isSameOrigin,
} from "./net-guard";
import {
  fetchRobotsTxt,
  pathAllowedByRobots,
  robotsDisallowsAll,
} from "./robots";
import type { PageSnapshot, ScanJob, ToolCandidate } from "./types";

let browserPromise: Promise<Browser> | null = null;
/** Scans in flight. The browser is only a candidate for shutdown at zero. */
let activeScans = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function idleTimeoutMs(): number {
  const configured = Number(process.env.BROWSER_IDLE_MS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : BROWSER_IDLE_MS;
}

function cancelIdleShutdown(): void {
  if (!idleTimer) return;
  clearTimeout(idleTimer);
  idleTimer = null;
}

/**
 * Keeping the browser warm saves a second or two on the next scan, which is
 * worth it while scans keep arriving. Holding it open forever is not: an idle
 * browser is several hundred megabytes charged to a machine that has other
 * work to do.
 */
function scheduleIdleShutdown(): void {
  cancelIdleShutdown();
  idleTimer = setTimeout(() => {
    idleTimer = null;
    // A scan may have started between the timer firing and this callback.
    if (activeScans === 0) void closeBrowser();
  }, idleTimeoutMs());
  // Never a reason to hold the process open on its own.
  idleTimer.unref?.();
}

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  cancelIdleShutdown();
  const closing = browserPromise;
  if (!closing) return;
  // Cleared before the await, not after. A scan starting while the teardown is
  // in flight must be handed a new browser rather than the one being closed.
  browserPromise = null;
  try {
    await (await closing).close();
  } catch {
    /* a browser that will not close is already gone */
  }
}

/**
 * Reads the configured engine. An unknown value is rejected rather than
 * quietly falling back, because silently scanning with the wrong browser is
 * harder to notice than a startup error.
 */
export function selectedEngine(): ScannerEngine {
  const raw = process.env.SCANNER_ENGINE?.trim().toLowerCase();
  if (!raw) return DEFAULT_SCANNER_ENGINE;
  if (raw === "chrome" || raw === "lightpanda") return raw;
  throw new Error(
    `Unknown SCANNER_ENGINE "${raw}". Expected "chrome" or "lightpanda".`
  );
}

function cdpUrl(): string {
  return process.env.SCANNER_CDP_URL?.trim() || DEFAULT_SCANNER_CDP_URL;
}

async function connectToLightpanda(): Promise<Browser> {
  const url = cdpUrl();
  try {
    return await chromium.connectOverCDP(url);
  } catch (err) {
    // Being unable to reach the server is a deployment problem, not a problem
    // with the site being scanned. Name the address so it is obvious which.
    const detail = err instanceof Error ? err.message.split("\n")[0] : String(err);
    throw new Error(`Lightpanda is not reachable at ${url}: ${detail}`);
  }
}

async function launchBrowser(): Promise<Browser> {
  return selectedEngine() === "lightpanda"
    ? connectToLightpanda()
    : launchChrome();
}

async function launchChrome(): Promise<Browser> {
  const args = [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--disable-extensions",
  ];
  const executablePath =
    process.env.CHROME_PATH ||
    process.env.PLAYWRIGHT_CHROME_PATH ||
    "/usr/local/bin/google-chrome";
  try {
    return await chromium.launch({
      headless: true,
      channel: "chrome",
      args,
    });
  } catch {
    return await chromium.launch({
      headless: true,
      executablePath,
      args,
    });
  }
}

export function parseScanUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("URL is required");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid http(s) URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be scanned");
  }
  return url;
}

type ScanResult = {
  url: string;
  origin: string;
  pages: PageSnapshot[];
  candidates: ToolCandidate[];
  robotsDisallowAll: boolean;
};

/**
 * Wraps the scan so the browser's lifetime is decided in one place: held open
 * while work is arriving, closed once nothing has needed it for a while.
 */
export async function scanSite(
  rawUrl: string,
  options?: { maxPages?: number; timeoutMs?: number; selfOrigin?: string }
): Promise<ScanResult> {
  activeScans += 1;
  cancelIdleShutdown();
  try {
    return await runScan(rawUrl, options);
  } finally {
    activeScans -= 1;
    if (activeScans === 0) scheduleIdleShutdown();
  }
}

async function runScan(
  rawUrl: string,
  options?: { maxPages?: number; timeoutMs?: number; selfOrigin?: string }
): Promise<ScanResult> {
  const startUrl = parseScanUrl(rawUrl);
  const origin = startUrl.origin;
  const maxPages = options?.maxPages ?? MAX_PAGES;
  const overallTimeout = options?.timeoutMs ?? SCAN_TIMEOUT_MS;
  const deadline = Date.now() + overallTimeout;

  const robotsTxt = await fetchRobotsTxt(origin, ROBOTS_TIMEOUT_MS);
  const robotsDisallowAll = robotsTxt ? robotsDisallowsAll(robotsTxt) : false;

  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    javaScriptEnabled: true,
    ignoreHTTPSErrors: true,
  });
  context.setDefaultTimeout(PAGE_TIMEOUT_MS);
  context.setDefaultNavigationTimeout(PAGE_TIMEOUT_MS);

  const pages: PageSnapshot[] = [];
  const visited = new Set<string>();

  try {
    const home = await visitPage(context, startUrl.href, deadline, options?.selfOrigin);
    pages.push(home);
    visited.add(normalizeVisit(startUrl.href));

    if (!robotsDisallowAll) {
      const extras = pickFollowUrls(home, origin, startUrl.href, maxPages - 1);
      for (const href of extras) {
        if (Date.now() > deadline) break;
        if (pages.length >= maxPages) break;
        const key = normalizeVisit(href);
        if (visited.has(key)) continue;
        if (robotsTxt && !pathAllowedByRobots(robotsTxt, new URL(href).pathname)) {
          continue;
        }
        visited.add(key);
        const snap = await visitPage(context, href, deadline, options?.selfOrigin);
        pages.push(snap);
      }
    }
  } finally {
    await context.close();
  }

  const candidates = proposeTools(pages, origin);
  return {
    url: startUrl.href,
    origin,
    pages,
    candidates,
    robotsDisallowAll,
  };
}

export async function createScanJob(rawUrl: string): Promise<Omit<ScanJob, "id" | "createdAt" | "updatedAt" | "status" | "includeLocalRelay">> {
  const result = await scanSite(rawUrl);
  return {
    url: result.url,
    origin: result.origin,
    pages: result.pages,
    candidates: result.candidates,
    robotsDisallowAll: result.robotsDisallowAll,
  };
}

/**
 * The second check: what the browser actually connected to, after it followed
 * whatever redirects it was given.
 *
 * The strong form reads the peer address off the response, which is ground
 * truth — it closes both redirects and DNS rebinding, because it reports the
 * address that was dialled rather than one this process resolved. Lightpanda
 * does not report it (measured: `serverAddr()` returns null there), so that
 * engine gets the weaker form: re-resolve every URL in the redirect chain.
 * That still refuses a redirect into the private network, but a name whose
 * answer changes between our lookup and the browser's slips through. The
 * limitation is real and is recorded in docs/decisions.md rather than papered
 * over.
 *
 * Runs before any content is read out of the page: order is the whole point.
 */
async function assertConnectionWasPublic(
  page: Page,
  response: Response | null,
  selfOrigin: string | undefined
): Promise<void> {
  if (!enforceConnectedIp()) return;
  // Landing back on our own address is not a forged request; it is the demo
  // shop. A chain that ends anywhere else is checked as normal.
  if (isSameOrigin(page.url(), selfOrigin)) return;

  if (selectedEngine() === "chrome") {
    const address = response ? await response.serverAddr() : null;
    // An absent address is not a pass. Something answered and we cannot say
    // what, which is exactly the case this check exists for.
    assertScannableIp(address?.ipAddress ?? null, { ignoreEscapeHatch: true });
    return;
  }

  const urls = new Set<string>([page.url()]);
  if (response) {
    urls.add(response.url());
    let hop = response.request().redirectedFrom();
    // A redirect loop would otherwise walk forever; the browser gave up long
    // before this many hops anyway.
    for (let i = 0; hop && i < 10; i++) {
      urls.add(hop.url());
      hop = hop.redirectedFrom();
    }
  }
  for (const url of urls) {
    await assertScannableUrl(new URL(url), {
      selfOrigin,
      ignoreEscapeHatch: true,
    });
  }
}

async function visitPage(
  context: Awaited<ReturnType<Browser["newContext"]>>,
  href: string,
  deadline: number,
  selfOrigin: string | undefined
): Promise<PageSnapshot> {
  const remaining = Math.max(1000, deadline - Date.now());
  const page: Page = await context.newPage();
  try {
    const response = await page.goto(href, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(PAGE_TIMEOUT_MS, remaining),
    });
    await page.waitForLoadState("domcontentloaded");
    await assertConnectionWasPublic(page, response, selfOrigin);
    const extracted = await page.evaluate(extractSnapshotInPage);
    return { url: page.url(), ...extracted };
  } catch (err) {
    // Everything else becomes an empty snapshot so one bad page cannot sink a
    // scan. A refusal must not: swallowed here it would return an empty page,
    // the scan would carry on, and the API would answer 200 with a tool list
    // for a site it was never allowed to open.
    if (err instanceof ScanBlockedError) throw err;
    return {
      url: href,
      title: "",
      headings: [],
      navLinks: [],
      links: [],
      forms: [],
      buttons: [],
      searchInputs: [],
      products: [],
      filters: [],
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await page.close();
  }
}

function normalizeVisit(href: string): string {
  try {
    const u = new URL(href);
    u.hash = "";
    let path = u.pathname;
    if (path.endsWith("/index.html")) path = path.slice(0, -11) || "/";
    if (path.endsWith("/") && path !== "/") path = path.slice(0, -1);
    return `${u.origin}${path}${u.search}`;
  } catch {
    return href;
  }
}

function pickFollowUrls(
  home: PageSnapshot,
  origin: string,
  startHref: string,
  budget: number
): string[] {
  const start = new URL(startHref);
  const candidates = [...home.navLinks, ...home.links].filter((l) => l.sameOrigin);
  const scored = candidates.map((l) => {
    const path = (l.path || "").toLowerCase();
    const text = (l.text || "").toLowerCase();
    let score = 0;
    if (/product|catalog|shop|store/.test(path + text)) score += 5;
    if (/about|contact|pricing|docs/.test(path + text)) score += 4;
    if (/search/.test(path + text)) score += 2;
    if (l.path === start.pathname) score -= 10;
    if (/\.(pdf|jpg|png|zip|css|js)$/i.test(path)) score -= 20;
    return { href: l.href, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const out: string[] = [];
  const seen = new Set<string>([normalizeVisit(startHref)]);
  for (const item of scored) {
    if (out.length >= budget) break;
    try {
      const u = new URL(item.href, origin);
      if (u.origin !== origin) continue;
      const key = normalizeVisit(u.href);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(u.href);
    } catch {
      /* skip */
    }
  }
  return out;
}
