import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The concurrency slot belongs to the scan, not to the request that started it.
 *
 * They used to be the same thing, and the difference shows when a request stops
 * waiting: the hard timeout answers the caller, but the scan is still running
 * and still holding a browser. Releasing the slot there would advertise
 * capacity that does not exist, on the box this limit is meant to protect.
 */

const { runScan } = vi.hoisted(() => ({ runScan: vi.fn() }));
vi.mock("@/lib/jobs", () => ({ runScan }));

const { POST } = await import("@/app/api/scan/route");
const { __resetForTests, acquireScan, releaseScan } = await import(
  "@/lib/rate-limit"
);

const DISABLED = "SCAN_RATE_LIMIT_DISABLED";
const CONCURRENT = "SCAN_MAX_CONCURRENT";
const original = {
  [DISABLED]: process.env[DISABLED],
  [CONCURRENT]: process.env[CONCURRENT],
};

beforeEach(() => {
  delete process.env[DISABLED];
  process.env[CONCURRENT] = "1";
  __resetForTests();
  runScan.mockReset();
});

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  __resetForTests();
});

/** Lets the microtask that gives the slot back actually run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function post() {
  return POST(
    new Request("http://scanner.test/api/scan", {
      method: "POST",
      headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" },
      body: JSON.stringify({ url: "https://example.test/" }),
    })
  );
}

describe("while a scan is running", () => {
  it("holds its slot, and gives it back when the work ends", async () => {
    let finish: (job: unknown) => void = () => {};
    let scanning: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      scanning = resolve;
    });
    runScan.mockImplementation(() => {
      scanning();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });

    const inFlight = post();
    // Waiting on the scan itself rather than on a guess about how many
    // microtasks the route needs to get there.
    await started;

    expect(
      acquireScan(),
      "the only slot is taken by the scan that is running"
    ).toBeNull();

    finish({ status: "ready" });
    const res = await inFlight;
    expect(res.status).toBe(200);
    // Settled on the promise, which is what owns the slot — not on the route
    // returning, which may happen first.
    await settle();

    const slot = acquireScan();
    expect(slot, "the slot comes back once the work is done").not.toBeNull();
    releaseScan(slot);
  });

  it("gives the slot back when the scan fails too", async () => {
    runScan.mockRejectedValue(new Error("scan blew up"));

    const res = await post();
    expect(res.status).toBe(400);
    await settle();

    const slot = acquireScan();
    expect(slot).not.toBeNull();
    releaseScan(slot);
  });
});

describe("a request turned away before it scans", () => {
  it("does not keep the slot it was handed", async () => {
    process.env.SCAN_RATE_MAX_PER_WINDOW = "1";
    runScan.mockResolvedValue({ status: "ready" });

    expect((await post()).status).toBe(200);
    await settle();

    // Refused on the per-address allowance, so no scan started. The slot taken
    // on the way in has to come back here rather than at the end of work that
    // never happened.
    expect((await post()).status).toBe(429);

    const slot = acquireScan();
    expect(slot).not.toBeNull();
    releaseScan(slot);
    delete process.env.SCAN_RATE_MAX_PER_WINDOW;
  });
});
