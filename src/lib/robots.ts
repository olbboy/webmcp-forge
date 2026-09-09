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

export async function fetchRobotsTxt(
  origin: string,
  timeoutMs: number
): Promise<string | null> {
  try {
    const res = await fetch(new URL("/robots.txt", origin), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "WebMCPForgeBot/1.0" },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}
