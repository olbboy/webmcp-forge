import { isIP } from "node:net";
import { promises as dns } from "node:dns";

/**
 * One message for every refusal, whichever check produced it.
 *
 * Saying "that address is private" for one URL and "could not connect" for
 * another turns this endpoint into an internal port scanner: the difference
 * between the two answers is the answer. Response timing still leaks a little,
 * which is a smaller hole than a plain-text oracle and is left open on purpose.
 */
export const SCAN_BLOCKED_MESSAGE =
  "That URL cannot be scanned. Only publicly reachable http(s) addresses are allowed.";

/** A refusal the caller caused and can act on, distinct from a scan failure. */
export class ScanBlockedError extends Error {
  constructor() {
    super(SCAN_BLOCKED_MESSAGE);
    this.name = "ScanBlockedError";
  }
}

/**
 * Ranges no public website is ever reachable at. Anything here is either this
 * machine, the private network around it, or a cloud metadata service.
 */
const BLOCKED_V4: ReadonlyArray<[string, number]> = [
  ["0.0.0.0", 8], // "this host on this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local — every cloud's metadata service lives here
  ["172.16.0.0", 12], // RFC1918
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.168.0.0", 16], // RFC1918
  ["198.18.0.0", 15], // benchmarking
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

const BLOCKED_V6: ReadonlyArray<[string, number]> = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  // Three ways to wrap an IPv4 address in an IPv6 one. Each of them can carry
  // a loopback or private address past a check that only knows the v6 ranges.
  ["::", 96], // IPv4-compatible, e.g. ::127.0.0.1
  ["2002::", 16], // 6to4, e.g. 2002:7f00:1::
  ["64:ff9b::", 96], // NAT64
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    out = (out << 8) | n;
  }
  return out >>> 0;
}

/** Expands `::` and returns the sixteen bytes, or null if the input is not v6. */
function v6ToBytes(ip: string): Uint8Array | null {
  const zone = ip.indexOf("%");
  const bare = zone === -1 ? ip : ip.slice(0, zone);
  const halves = bare.split("::");
  if (halves.length > 2) return null;

  const toGroups = (s: string) => (s === "" ? [] : s.split(":"));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];

  // A trailing IPv4 literal (::ffff:127.0.0.1) occupies the final two groups.
  const last = tail.length > 0 ? tail[tail.length - 1] : head[head.length - 1];
  let v4Groups: string[] = [];
  if (last && last.includes(".")) {
    const n = v4ToInt(last);
    if (n === null) return null;
    v4Groups = [
      ((n >>> 16) & 0xffff).toString(16),
      (n & 0xffff).toString(16),
    ];
    if (tail.length > 0) tail.pop();
    else head.pop();
  }

  const groups = [...head, ...tail, ...v4Groups];
  const explicit = head.length + tail.length + v4Groups.length;
  if (halves.length === 1 && explicit !== 8) return null;
  if (explicit > 8) return null;

  const filled: string[] =
    halves.length === 2
      ? [
          ...head,
          ...Array(8 - explicit).fill("0"),
          ...tail,
          ...v4Groups,
        ]
      : groups;
  if (filled.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(filled[i])) return null;
    const n = parseInt(filled[i], 16);
    bytes[i * 2] = (n >> 8) & 0xff;
    bytes[i * 2 + 1] = n & 0xff;
  }
  return bytes;
}

function bytesInPrefix(
  addr: Uint8Array,
  prefix: Uint8Array,
  bits: number
): boolean {
  const whole = Math.floor(bits / 8);
  for (let i = 0; i < whole; i++) {
    if (addr[i] !== prefix[i]) return false;
  }
  const rest = bits % 8;
  if (rest === 0) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return (addr[whole] & mask) === (prefix[whole] & mask);
}

/**
 * An IPv4 address wearing an IPv6 costume. `http://[::ffff:127.0.0.1]` is
 * loopback, and a check that only understands dotted quads waves it through —
 * which is why this runs before any range comparison.
 */
function unmapV4(ip: string): string {
  const bytes = v6ToBytes(ip);
  if (!bytes) return ip;
  const isMapped =
    bytes.slice(0, 10).every((b) => b === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff;
  if (!isMapped) return ip;
  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}

export function isBlockedIp(raw: string): boolean {
  const ip = unmapV4(raw.trim());
  const kind = isIP(ip);

  if (kind === 4) {
    const value = v4ToInt(ip);
    if (value === null) return true;
    return BLOCKED_V4.some(([base, bits]) => {
      const prefix = v4ToInt(base);
      if (prefix === null) return false;
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (value & mask) >>> 0 === (prefix & mask) >>> 0;
    });
  }

  if (kind === 6) {
    const bytes = v6ToBytes(ip);
    if (!bytes) return true;
    return BLOCKED_V6.some(([base, bits]) => {
      const prefix = v6ToBytes(base);
      return prefix ? bytesInPrefix(bytes, prefix, bits) : false;
    });
  }

  // Not an address at all. Refusing is the safe answer for something this
  // function was asked to vouch for and cannot.
  return true;
}

let warnedAboutEscapeHatch = false;

/**
 * The test suite scans a fixture server on 127.0.0.1, so the guard needs a way
 * off. It is an environment variable rather than a code flag so production
 * cannot reach it by accident, and it announces itself on first use: a check at
 * deploy time does not stop someone adding it to `.env` a month later to debug
 * one site and forgetting to take it out.
 */
/**
 * Reads the escape hatch once at startup so the warning lands in the log a
 * deploy is checked against. Left to the first scan, the line only appears once
 * somebody happens to use the endpoint, which is exactly when nobody is looking
 * at the log for it.
 */
export function warnIfEscapeHatchOpen(): void {
  allowPrivateHosts();
}

export function allowPrivateHosts(): boolean {
  const on = process.env.SCAN_ALLOW_PRIVATE_HOSTS === "1";
  if (on && !warnedAboutEscapeHatch) {
    warnedAboutEscapeHatch = true;
    console.warn(
      "[webmcp-forge] SCAN_ALLOW_PRIVATE_HOSTS=1 — private addresses are scannable. Never set this in production."
    );
  }
  return on;
}

/** Kill switch for the post-navigation check, so a bad day needs no rebuild. */
export function enforceConnectedIp(): boolean {
  return process.env.SCAN_ENFORCE_CONNECTED_IP !== "0";
}

export function isSameOrigin(
  url: URL | string,
  selfOrigin: string | undefined
): boolean {
  if (!selfOrigin) return false;
  try {
    const target = typeof url === "string" ? new URL(url) : url;
    return target.origin === new URL(selfOrigin).origin;
  } catch {
    return false;
  }
}

/**
 * The first of two checks: refuse before a browser is ever pointed at the URL.
 *
 * Resolving here catches the case a literal-address blocklist misses entirely —
 * a perfectly ordinary hostname whose A record happens to be 127.0.0.1. Every
 * address behind the name has to be public, not just the first one.
 */
export async function assertScannableUrl(
  url: URL,
  options?: { selfOrigin?: string; ignoreEscapeHatch?: boolean }
): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ScanBlockedError();
  }
  // The app's own address is not an SSRF target, and the "Try the demo shop"
  // button points at it. In development that is localhost, which every other
  // rule here would refuse.
  if (isSameOrigin(url, options?.selfOrigin)) return;
  // The post-navigation check passes `ignoreEscapeHatch` so the two guards can
  // be switched independently. Sharing one switch is how a test for the second
  // guard ends up proving only that the first one works.
  if (!options?.ignoreEscapeHatch && allowPrivateHosts()) return;

  // `URL` keeps the brackets on an IPv6 literal, and dns.lookup rejects them,
  // so this used to end up refusing every bracketed address by way of a
  // resolver error. That happened to be safe and was not the check doing its
  // job: a literal is already an address and deserves the range test directly.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) !== 0) {
    if (isBlockedIp(hostname)) throw new ScanBlockedError();
    return;
  }

  let records: Array<{ address: string }>;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    // A name that will not resolve is not scannable either way, and failing
    // closed keeps resolver errors from becoming a way around the check.
    throw new ScanBlockedError();
  }
  if (records.length === 0) throw new ScanBlockedError();
  for (const record of records) {
    if (isBlockedIp(record.address)) throw new ScanBlockedError();
  }
}

/** Same rule, for an address rather than a URL. */
export function assertScannableIp(
  ip: string | null | undefined,
  options?: { ignoreEscapeHatch?: boolean }
): void {
  if (!options?.ignoreEscapeHatch && allowPrivateHosts()) return;
  if (!ip || isBlockedIp(ip)) throw new ScanBlockedError();
}

/**
 * The address reduced to what a rate limiter should count.
 *
 * IPv4 is one address per subscriber. IPv6 is not: a home connection is
 * routinely handed a /64, so counting whole addresses lets one visitor take a
 * fresh bucket for every request by changing the last four groups.
 */
export function ipNetworkKey(raw: string): string {
  const ip = unmapV4(raw.trim());
  if (isIP(ip) === 4) return ip;
  const bytes = v6ToBytes(ip);
  if (!bytes) return ip;
  const groups: string[] = [];
  for (let i = 0; i < 4; i++) {
    groups.push(((bytes[i * 2] << 8) | bytes[i * 2 + 1]).toString(16));
  }
  return `${groups.join(":")}::/64`;
}

/**
 * The origin to exempt from these checks, or nothing.
 *
 * Anything this app serves is reachable at the address it is answering on, and
 * asking it about itself is not server-side request forgery — the "Try the demo
 * shop" button does exactly that. Deployed, that address is a public hostname
 * these checks allow anyway, so the exemption only ever matters in development,
 * where the app answers on loopback.
 *
 * It comes from the Host header because Next rewrites `request.url` to
 * `localhost` whatever the browser asked for, and `localhost` and `127.0.0.1`
 * are different origins. A header the caller sets is precisely what must not be
 * able to wave a URL past a guard, which is why this returns nothing at all
 * outside development rather than trying to validate it.
 */
export function developmentSelfOrigin(request: Request): string | undefined {
  if (process.env.NODE_ENV === "production") return undefined;
  const host = request.headers.get("host");
  if (!host) return undefined;
  try {
    return new URL(`http://${host}`).origin;
  } catch {
    return undefined;
  }
}
