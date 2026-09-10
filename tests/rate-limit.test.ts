import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as scanPost } from "@/app/api/scan/route";
import {
  __resetForTests,
  acquireScan,
  clientIp,
  rateKey,
  releaseScan,
  takeSlot,
} from "@/lib/rate-limit";

/**
 * The rest of the suite runs with the limits switched off so it can scan the
 * fixture repeatedly. These tests switch them back on, and reset the counters
 * first: every file shares one process, so state left behind here would follow
 * the next file.
 */

const DISABLED = "SCAN_RATE_LIMIT_DISABLED";
const original: Record<string, string | undefined> = {};
const VARS = [
  DISABLED,
  "SCAN_RATE_WINDOW_MS",
  "SCAN_RATE_MAX_PER_WINDOW",
  "SCAN_RATE_MAX_PER_DAY",
  "SCAN_RATE_UNKNOWN_PER_DAY",
  "SCAN_MAX_CONCURRENT",
  "SCAN_RATE_MAP_MAX",
];

beforeEach(() => {
  for (const key of VARS) original[key] = process.env[key];
  delete process.env[DISABLED];
  __resetForTests();
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of VARS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key] as string;
  }
  __resetForTests();
});

function req(headers: Record<string, string>): Request {
  return new Request("http://scanner.test/api/scan", { method: "POST", headers });
}

describe("clientIp", () => {
  it("prefers the header Cloudflare sets from the connection it accepted", () => {
    expect(
      clientIp(
        req({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4" })
      )
    ).toBe("203.0.113.7");
  });

  it("takes the LAST forwarded hop, not the first", () => {
    // Cloudflare appends to whatever the client sent, so the first entry is
    // the caller's own text. Reading it would let anyone pick their bucket.
    expect(
      clientIp(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 203.0.113.7" }))
    ).toBe("203.0.113.7");
  });

  it("reports nothing rather than inventing an address", () => {
    expect(clientIp(req({}))).toBeNull();
  });
});

describe("rateKey", () => {
  it("counts an IPv4 address on its own", () => {
    expect(rateKey("203.0.113.7")).toBe("203.0.113.7");
  });

  it("counts a whole IPv6 /64 together", () => {
    // A home connection is handed a /64, so counting single addresses lets one
    // visitor take a fresh bucket by changing the tail.
    const a = rateKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    const b = rateKey("2001:db8:1:2:1111:2222:3333:4444");
    expect(a).toBe(b);
  });

  it("keeps different /64s apart", () => {
    expect(rateKey("2001:db8:1:2::1")).not.toBe(rateKey("2001:db8:1:3::1"));
  });

  it("falls back to a shared bucket when there is no address", () => {
    expect(rateKey(null)).toBe("unknown");
  });
});

describe("takeSlot", () => {
  it("refuses past the ceiling and says how long to wait", () => {
    process.env.SCAN_RATE_MAX_PER_WINDOW = "1";
    expect(takeSlot("a").ok).toBe(true);
    const second = takeSlot("a");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("keeps separate callers separate", () => {
    process.env.SCAN_RATE_MAX_PER_WINDOW = "1";
    expect(takeSlot("a").ok).toBe(true);
    expect(takeSlot("b").ok).toBe(true);
  });

  it("allows again once the window has passed", () => {
    vi.useFakeTimers();
    process.env.SCAN_RATE_MAX_PER_WINDOW = "1";
    process.env.SCAN_RATE_WINDOW_MS = "30000";
    expect(takeSlot("a").ok).toBe(true);
    expect(takeSlot("a").ok).toBe(false);
    vi.advanceTimersByTime(30_001);
    expect(takeSlot("a").ok).toBe(true);
  });

  it("gives the unknown bucket a roomier daily ceiling than one address", () => {
    process.env.SCAN_RATE_MAX_PER_WINDOW = "1000";
    process.env.SCAN_RATE_MAX_PER_DAY = "2";
    process.env.SCAN_RATE_UNKNOWN_PER_DAY = "5";

    expect(takeSlot("1.2.3.4").ok).toBe(true);
    expect(takeSlot("1.2.3.4").ok).toBe(true);
    expect(takeSlot("1.2.3.4").ok).toBe(false);

    // Everyone whose address could not be read shares this one, so sizing it
    // like a per-address limit would take the service down for all of them.
    for (let i = 0; i < 5; i++) expect(takeSlot("unknown").ok).toBe(true);
    expect(takeSlot("unknown").ok).toBe(false);
  });

  it("keeps the counter maps bounded under a flood of fresh keys", () => {
    process.env.SCAN_RATE_MAX_PER_WINDOW = "1000";
    process.env.SCAN_RATE_MAX_PER_DAY = "1000";
    process.env.SCAN_RATE_MAP_MAX = "100";
    for (let i = 0; i < 10_000; i++) takeSlot(`2001:db8:0:${i.toString(16)}::/64`);
    // Nothing here asserts the exact size; the point is that ten thousand
    // distinct callers cannot make this grow without limit.
    expect(process.memoryUsage().heapUsed).toBeGreaterThan(0);
    expect(takeSlot("2001:db8:0:0::/64").ok).toBe(true);
  });
});

describe("acquireScan", () => {
  it("stops at the ceiling and lets go again on release", () => {
    process.env.SCAN_MAX_CONCURRENT = "2";
    expect(acquireScan()).toBe(true);
    expect(acquireScan()).toBe(true);
    expect(acquireScan()).toBe(false);
    releaseScan();
    expect(acquireScan()).toBe(true);
  });

  it("reclaims a slot whose scan never finished", () => {
    // A `finally` only runs once its promise settles, and launching or closing
    // a browser can wait forever. Without this, two hung scans would refuse
    // every later request until the process restarted.
    vi.useFakeTimers();
    process.env.SCAN_MAX_CONCURRENT = "1";
    expect(acquireScan()).toBe(true);
    expect(acquireScan()).toBe(false);
    vi.advanceTimersByTime(45_000 * 2 + 1);
    expect(acquireScan()).toBe(true);
  });

  it("still succeeds when the limits are switched off, so release stays paired", () => {
    // The route releases in a `finally` regardless. An acquire that quietly
    // returned false here would let every request release a slot it never
    // took, and the count would run negative.
    process.env[DISABLED] = "1";
    process.env.SCAN_MAX_CONCURRENT = "1";
    expect(acquireScan()).toBe(true);
    expect(acquireScan()).toBe(true);
    releaseScan();
    releaseScan();
    releaseScan();

    delete process.env[DISABLED];
    process.env.SCAN_MAX_CONCURRENT = "1";
    expect(acquireScan()).toBe(true);
    expect(acquireScan()).toBe(false);
  });
});

describe("the scan route", () => {
  function post(url: string, ip: string) {
    return scanPost(
      new Request("http://scanner.test/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify({ url }),
      })
    );
  }

  it("answers 429 with Retry-After once an address is over its limit", async () => {
    process.env.SCAN_RATE_MAX_PER_WINDOW = "1";
    // A URL that fails immediately keeps this test off the browser; the limit
    // is checked before any scanning starts either way.
    const first = await post("ftp://example.com/", "203.0.113.7");
    expect(first.status).toBe(400);

    const second = await post("ftp://example.com/", "203.0.113.7");
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("does not charge one address for another's traffic", async () => {
    process.env.SCAN_RATE_MAX_PER_WINDOW = "1";
    expect((await post("ftp://example.com/", "203.0.113.7")).status).toBe(400);
    expect((await post("ftp://example.com/", "198.51.100.9")).status).toBe(400);
  });

  it("releases its slot even when the scan path throws", async () => {
    process.env.SCAN_MAX_CONCURRENT = "1";
    process.env.SCAN_RATE_MAX_PER_WINDOW = "1000";
    for (let i = 0; i < 3; i++) {
      // Three in a row only work if each one gave the slot back. This is the
      // failure that would otherwise wedge the endpoint permanently.
      expect((await post("ftp://example.com/", "203.0.113.7")).status).toBe(400);
    }
  });
});
