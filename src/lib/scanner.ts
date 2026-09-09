import { chromium, type Browser, type Page } from "playwright";
import {
  MAX_PAGES,
  PAGE_TIMEOUT_MS,
  ROBOTS_TIMEOUT_MS,
  SCAN_TIMEOUT_MS,
  USER_AGENT,
} from "./config";
import { extractSnapshotInPage } from "./extract";
import { proposeTools } from "./heuristics";
import {
  fetchRobotsTxt,
  pathAllowedByRobots,
  robotsDisallowsAll,
} from "./robots";
import type { PageSnapshot, ScanJob, ToolCandidate } from "./types";

let browserPromise: Promise<Browser> | null = null;

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
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    /* ignore */
  } finally {
    browserPromise = null;
  }
}

async function launchBrowser(): Promise<Browser> {
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

export async function scanSite(
  rawUrl: string,
  options?: { maxPages?: number; timeoutMs?: number }
): Promise<{
  url: string;
  origin: string;
  pages: PageSnapshot[];
  candidates: ToolCandidate[];
  robotsDisallowAll: boolean;
}> {
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
    const home = await visitPage(context, startUrl.href, deadline);
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
        const snap = await visitPage(context, href, deadline);
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

async function visitPage(
  context: Awaited<ReturnType<Browser["newContext"]>>,
  href: string,
  deadline: number
): Promise<PageSnapshot> {
  const remaining = Math.max(1000, deadline - Date.now());
  const page: Page = await context.newPage();
  try {
    await page.goto(href, {
      waitUntil: "domcontentloaded",
      timeout: Math.min(PAGE_TIMEOUT_MS, remaining),
    });
    await page.waitForLoadState("domcontentloaded");
    const extracted = await page.evaluate(extractSnapshotInPage);
    return { url: page.url(), ...extracted };
  } catch (err) {
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
