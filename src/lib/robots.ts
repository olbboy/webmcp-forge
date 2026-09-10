import { assertScannableUrl } from "./net-guard";

export function pathAllowedByRobots(robotsTxt: string, pathname: string): boolean {
  if (!robotsTxt.trim()) return true;
  const lines = robotsTxt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  let inStar = false;
  let sawStar = false;
  const disallows: string[] = [];
  const allows: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      inStar = value === "*";
      if (inStar) sawStar = true;
      continue;
    }
    if (!inStar) continue;
    if (key === "disallow") disallows.push(value);
    if (key === "allow") allows.push(value);
  }

  if (!sawStar) return true;

  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;

  const matches = (rule: string) => {
    if (rule === "") return false;
    if (rule === "/") return true;
    return path === rule || path.startsWith(rule.endsWith("/") ? rule : `${rule}`);
  };

  const allowHit = allows.filter(matches).sort((a, b) => b.length - a.length)[0];
  const disallowHit = disallows.filter(matches).sort((a, b) => b.length - a.length)[0];
  if (allowHit && (!disallowHit || allowHit.length >= disallowHit.length)) return true;
  if (disallowHit) return false;
  return true;
}

export function robotsDisallowsAll(robotsTxt: string): boolean {
  return !pathAllowedByRobots(robotsTxt, "/");
}

/** Enough to follow a site that moved its robots file, not enough to chase a loop. */
const MAX_ROBOTS_REDIRECTS = 3;

/**
 * Fetches `/robots.txt`, following redirects by hand.
 *
 * The site's own address was cleared before any of this ran, but this request
 * is made by Node rather than the browser, so neither of the scanner's checks
 * covers it. Left on the default `redirect: "follow"` it is a second way in:
 * a public host answers 302 for its robots file and points at 169.254.169.254,
 * and fetch obliges. Reading `Location` and clearing each hop first closes it.
 */
export async function fetchRobotsTxt(
  origin: string,
  timeoutMs: number
): Promise<string | null> {
  let target: URL;
  try {
    target = new URL("/robots.txt", origin);
  } catch {
    return null;
  }

  try {
    for (let hop = 0; hop <= MAX_ROBOTS_REDIRECTS; hop++) {
      const res = await fetch(target, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "WebMCPForgeBot/1.0" },
      });

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        const next = new URL(location, target);
        // Same rule as the URL the caller asked for, and deliberately deaf to
        // the escape hatch. That hatch exists so this project's own tests can
        // point the scanner at a fixture they run on loopback — an address the
        // operator chose. A redirect target is chosen by the site being
        // scanned, so it never inherits that trust.
        await assertScannableUrl(next, { ignoreEscapeHatch: true });
        target = next;
        continue;
      }

      if (!res.ok) return null;
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("html")) return null;
      return await res.text();
    }
    return null;
  } catch {
    // A missing or unreachable robots.txt is normal, and a refused redirect is
    // treated the same way: no rules found, and nothing follows the pointer.
    return null;
  }
}
