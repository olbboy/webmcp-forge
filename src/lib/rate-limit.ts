import { SCAN_TIMEOUT_MS } from "./config";
import { ipNetworkKey } from "./net-guard";

/**
 * Counters for `/api/scan`, kept in this process's memory.
 *
 * That is enough because the container runs a single `next-server` process, and
 * a scan costs a browser rather than a database row: the thing being protected
 * is the memory on a box shared with someone else's production service. If this
 * app is ever run as more than one instance, each copy will count on its own and
 * this stops being a limit.
 */

const UNKNOWN_KEY = "unknown";

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

// Read per call rather than captured at import, so the deployed thresholds can
// be changed with a restart instead of a rebuild — and so tests can move them.
const windowMs = () => envInt("SCAN_RATE_WINDOW_MS", 30_000);
const maxPerWindow = () => envInt("SCAN_RATE_MAX_PER_WINDOW", 1);
const maxPerDay = () => envInt("SCAN_RATE_MAX_PER_DAY", 20);
/**
 * When the client address cannot be determined every caller shares one bucket,
 * so that bucket gets its own, roomier ceiling. Sized like a per-IP limit it
 * would be a denial of service with extra steps: one visitor's twentieth scan
 * would lock out everyone else until midnight.
 */
const maxUnknownPerDay = () => envInt("SCAN_RATE_UNKNOWN_PER_DAY", 200);
const maxConcurrent = () => envInt("SCAN_MAX_CONCURRENT", 1);
const mapMax = () => envInt("SCAN_RATE_MAP_MAX", 5_000);

export function isRateLimitDisabled(): boolean {
  return process.env.SCAN_RATE_LIMIT_DISABLED === "1";
}

/**
 * The address to count against.
 *
 * `CF-Connecting-IP` is set by Cloudflare's edge from the connection it
 * accepted, and this origin has no inbound port of its own — every request
 * arrives through the tunnel — so it cannot be dictated by the caller.
 *
 * `X-Forwarded-For` is different. Cloudflare *appends* to whatever the client
 * sent, so the first entry is the client's own text and using it hands the
 * caller a way to pick a fresh bucket per request. The last entry is the hop
 * that reached us.
 */
export function clientIp(request: Request): string | null {
  const direct = request.headers.get("cf-connecting-ip");
  if (direct && direct.trim()) return direct.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return null;
}

export function rateKey(ip: string | null): string {
  if (!ip) return UNKNOWN_KEY;
  return ipNetworkKey(ip);
}

type Counter = { count: number; resetAt: number };

const windowCounts = new Map<string, Counter>();
const dayCounts = new Map<string, Counter>();

/**
 * Keeps a map from growing without bound.
 *
 * Dropping only expired entries is not enough on its own: a day bucket lives
 * for twenty-four hours, so a caller cycling through addresses adds entries
 * far faster than any of them age out. Past the cap the oldest go regardless,
 * which costs a little accuracy and cannot cost the process its memory.
 */
function prune(map: Map<string, Counter>, now: number): void {
  if (map.size <= mapMax()) return;
  for (const [key, counter] of map) {
    if (counter.resetAt <= now) map.delete(key);
  }
  // Map iterates in insertion order, so the front of it is the oldest.
  while (map.size > mapMax()) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

function bump(
  map: Map<string, Counter>,
  key: string,
  now: number,
  ttlMs: number,
  limit: number
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const existing = map.get(key);
  if (!existing || existing.resetAt <= now) {
    prune(map, now);
    map.set(key, { count: 1, resetAt: now + ttlMs });
    return { ok: true };
  }
  if (existing.count >= limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  existing.count += 1;
  return { ok: true };
}

function msUntilNextUtcDay(now: number): number {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next.getTime() - now;
}

export function takeSlot(
  key: string
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  if (isRateLimitDisabled()) return { ok: true };
  const now = Date.now();

  const perDay = key === UNKNOWN_KEY ? maxUnknownPerDay() : maxPerDay();
  const daily = bump(dayCounts, key, now, msUntilNextUtcDay(now), perDay);
  if (!daily.ok) return daily;

  return bump(windowCounts, key, now, windowMs(), maxPerWindow());
}

/** Scans in flight, by the moment each one started. */
let inFlight: number[] = [];

/**
 * A slot is a promise to release it, and a promise can be broken: a `finally`
 * only runs once its promise settles, and the scan path has waits with no
 * timeout of their own — launching a browser, connecting to one over CDP,
 * closing a context. Two of those hanging would otherwise mean every later
 * request is refused for the life of the process, with a restart as the only
 * way out. Slots older than any scan could legitimately be therefore expire.
 */
function reclaimStale(now: number): void {
  const cutoff = now - SCAN_TIMEOUT_MS * 2;
  inFlight = inFlight.filter((startedAt) => startedAt > cutoff);
}

export function acquireScan(): boolean {
  // True when switched off, so the caller's try/finally stays symmetric. An
  // acquire that is skipped while its release still runs drives the count
  // negative and quietly raises the ceiling.
  if (isRateLimitDisabled()) return true;
  const now = Date.now();
  reclaimStale(now);
  if (inFlight.length >= maxConcurrent()) return false;
  inFlight.push(now);
  return true;
}

export function releaseScan(): void {
  if (isRateLimitDisabled()) return;
  inFlight.shift();
}

/** How long a caller should wait when the concurrency ceiling turned them away. */
export function concurrencyRetryAfterSeconds(): number {
  return Math.max(1, Math.ceil(windowMs() / 1000));
}

export function __resetForTests(): void {
  windowCounts.clear();
  dayCounts.clear();
  inFlight = [];
}
