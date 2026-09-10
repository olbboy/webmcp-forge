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
//
// Three scans in half a minute and sixty in a day is what a person actually
// does: paste a URL, look at the tools, change something, scan again. The
// numbers started at one and twenty, which turned out to refuse the second
// attempt after a typo — a refused request spends its allowance too, which is
// deliberate against probing and unkind to someone who mistyped. Sixty a day
// keeps that from simply moving the wall three minutes further out.
const windowMs = () => envInt("SCAN_RATE_WINDOW_MS", 30_000);
const maxPerWindow = () => envInt("SCAN_RATE_MAX_PER_WINDOW", 3);
const maxPerDay = () => envInt("SCAN_RATE_MAX_PER_DAY", 60);
/**
 * When the client address cannot be determined every caller shares one bucket,
 * so that bucket gets its own, roomier ceiling. Sized like a per-IP limit it
 * would be a denial of service with extra steps: one visitor's twentieth scan
 * would lock out everyone else until midnight.
 */
const maxUnknownPerDay = () => envInt("SCAN_RATE_UNKNOWN_PER_DAY", 200);
const maxConcurrent = () => envInt("SCAN_MAX_CONCURRENT", 1);
/**
 * How many distinct callers each counter map will hold. Roomy on purpose: it is
 * a memory ceiling, not a policy, and the policy above refuses rather than
 * evicts once it is reached.
 */
const mapMax = () => envInt("SCAN_RATE_MAP_MAX", 20_000);

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
let reportedSource = false;

export function clientIp(request: Request): string | null {
  const direct = request.headers.get("cf-connecting-ip");
  if (direct && direct.trim()) {
    reportSource("cf-connecting-ip");
    return direct.trim();
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length > 0) {
      reportSource(`x-forwarded-for (${hops.length} hop(s))`);
      return hops[hops.length - 1];
    }
  }
  reportSource("none");
  return null;
}

/**
 * Says once which header the address came from.
 *
 * Whether `CF-Connecting-IP` survives the tunnel decides whether these limits
 * count real callers or drop everyone into one shared bucket, and there is no
 * way to know from outside. The name of the header is logged and never its
 * value: the value is somebody's address.
 */
function reportSource(source: string): void {
  if (reportedSource) return;
  reportedSource = true;
  console.info(`[webmcp-forge] client address read from: ${source}`);
}

export function rateKey(ip: string | null): string {
  if (!ip) return UNKNOWN_KEY;
  return ipNetworkKey(ip);
}

type Counter = { count: number; resetAt: number };

const windowCounts = new Map<string, Counter>();
const dayCounts = new Map<string, Counter>();

/**
 * Drops entries whose window has already passed. Free to do and enough on its
 * own most of the time: a thirty-second bucket clears itself constantly.
 */
function dropExpired(map: Map<string, Counter>, now: number): void {
  for (const [key, counter] of map) {
    if (counter.resetAt <= now) map.delete(key);
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
  if (existing && existing.resetAt > now) {
    if (existing.count >= limit) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.resetAt - now) / 1000)
        ),
      };
    }
    existing.count += 1;
    return { ok: true };
  }

  dropExpired(map, now);
  // Full of counters that are all still live. Making room would mean deleting
  // one, and deleting one is how a caller clears their own count: reach the
  // daily ceiling, then send traffic from five thousand fresh addresses until
  // the entry counting your scans is the one evicted. Refusing instead makes
  // that pointless — the flood locks the flooder out along with everyone else,
  // and a day bucket holds for a day.
  //
  // The cost is real and deliberate: past this many distinct callers in one
  // day, a new caller waits. On a service where a busy day is dozens, that
  // ceiling is somewhere a flood can reach and ordinary use cannot.
  if (map.size >= mapMax()) {
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(ttlMs / 1000)) };
  }

  map.set(key, { count: 1, resetAt: now + ttlMs });
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

/**
 * Scans in flight, each under a token of its own.
 *
 * A plain array released with `shift` gives back whichever slot is oldest
 * rather than the one the caller took, and once a stale slot has been reclaimed
 * the request that owned it comes back and releases somebody else's. Each of
 * those raises the real ceiling by one, for good.
 */
const inFlight = new Map<number, number>();
let nextToken = 1;

/** What `acquireScan` hands back, and `releaseScan` needs to give it up. */
export type ScanSlot = number | null;

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
  for (const [token, startedAt] of inFlight) {
    if (startedAt <= cutoff) inFlight.delete(token);
  }
}

/**
 * Returns a token to release, or null when the ceiling is reached.
 *
 * A token is handed out even when the limits are off, so the caller's
 * try/finally stays symmetric: an acquire that is skipped while its release
 * still runs would give back a slot it never took.
 */
export function acquireScan(): ScanSlot {
  if (isRateLimitDisabled()) return 0;
  const now = Date.now();
  reclaimStale(now);
  if (inFlight.size >= maxConcurrent()) return null;
  const token = nextToken++;
  inFlight.set(token, now);
  return token;
}

export function releaseScan(slot: ScanSlot): void {
  if (slot === null || slot === 0) return;
  // By token, so a request that outlived its slot being reclaimed cannot give
  // away the slot somebody else is holding.
  inFlight.delete(slot);
}

/** How long a caller should wait when the concurrency ceiling turned them away. */
export function concurrencyRetryAfterSeconds(): number {
  return Math.max(1, Math.ceil(windowMs() / 1000));
}

export function __resetForTests(): void {
  reportedSource = false;
  windowCounts.clear();
  dayCounts.clear();
  inFlight.clear();
  nextToken = 1;
}
