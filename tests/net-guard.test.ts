import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ScanBlockedError,
  assertScannableIp,
  assertScannableUrl,
  isBlockedIp,
} from "@/lib/net-guard";

/**
 * The whole suite runs with the escape hatch on so the fixture server stays
 * reachable, so every test here has to switch it off first or it proves
 * nothing.
 */
function withGuardOn(fn: () => void | Promise<void>) {
  return async () => {
    const previous = process.env.SCAN_ALLOW_PRIVATE_HOSTS;
    delete process.env.SCAN_ALLOW_PRIVATE_HOSTS;
    try {
      await fn();
    } finally {
      if (previous !== undefined) process.env.SCAN_ALLOW_PRIVATE_HOSTS = previous;
    }
  };
}

describe("isBlockedIp", () => {
  const blocked = [
    ["loopback v4", "127.0.0.1"],
    ["loopback v4, high in range", "127.255.255.254"],
    ["cloud metadata", "169.254.169.254"],
    ["link-local edge", "169.254.0.0"],
    ["RFC1918 ten", "10.1.2.3"],
    ["RFC1918 172.16 low edge", "172.16.0.0"],
    ["RFC1918 172.31 high edge", "172.31.255.255"],
    ["RFC1918 192.168", "192.168.1.1"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["this host", "0.0.0.0"],
    ["multicast", "224.0.0.1"],
    ["loopback v6", "::1"],
    ["unspecified v6", "::"],
    ["unique local v6", "fd00::1"],
    ["link-local v6", "fe80::1"],
    ["multicast v6", "ff02::1"],
    ["IPv4-mapped loopback", "::ffff:127.0.0.1"],
    ["IPv4-mapped metadata", "::ffff:169.254.169.254"],
    ["not an address at all", "not-an-ip"],
  ] as const;

  for (const [name, ip] of blocked) {
    it(`blocks ${name} (${ip})`, () => {
      expect(isBlockedIp(ip)).toBe(true);
    });
  }

  const allowed = [
    ["public v4", "8.8.8.8"],
    ["public v4, just past RFC1918", "172.32.0.1"],
    ["public v4, just below RFC1918", "172.15.255.255"],
    ["public v4, just past CGNAT", "100.128.0.1"],
    ["public v6", "2606:4700:4700::1111"],
    ["IPv4-mapped public", "::ffff:8.8.8.8"],
  ] as const;

  for (const [name, ip] of allowed) {
    it(`allows ${name} (${ip})`, () => {
      expect(isBlockedIp(ip)).toBe(false);
    });
  }
});

describe("assertScannableIp", () => {
  it(
    "refuses a missing address rather than assuming it was fine",
    withGuardOn(() => {
      expect(() => assertScannableIp(null)).toThrow(ScanBlockedError);
      expect(() => assertScannableIp(undefined)).toThrow(ScanBlockedError);
    })
  );

  it(
    "allows a public address",
    withGuardOn(() => {
      expect(() => assertScannableIp("8.8.8.8")).not.toThrow();
    })
  );
});

describe("assertScannableUrl", () => {
  it(
    "refuses a hostname that resolves to loopback",
    withGuardOn(async () => {
      // localtest.me is a public name whose A record is 127.0.0.1, which is
      // exactly the shape a literal-address blocklist cannot see.
      await expect(
        assertScannableUrl(new URL("http://localtest.me/"))
      ).rejects.toThrow(ScanBlockedError);
    })
  );

  it(
    "refuses a literal private address",
    withGuardOn(async () => {
      await expect(
        assertScannableUrl(new URL("http://169.254.169.254/"))
      ).rejects.toThrow(ScanBlockedError);
    })
  );

  it(
    "refuses a non-http scheme",
    withGuardOn(async () => {
      await expect(
        assertScannableUrl(new URL("file:///etc/passwd"))
      ).rejects.toThrow(ScanBlockedError);
    })
  );

  it(
    "allows the app's own origin, which is what the demo button points at",
    withGuardOn(async () => {
      await expect(
        assertScannableUrl(new URL("http://127.0.0.1:43127/fixture-shop/index.html"), {
          selfOrigin: "http://127.0.0.1:43127",
        })
      ).resolves.toBeUndefined();
    })
  );

  it(
    "does not treat a different port on the same host as its own origin",
    withGuardOn(async () => {
      await expect(
        assertScannableUrl(new URL("http://127.0.0.1:9999/"), {
          selfOrigin: "http://127.0.0.1:43127",
        })
      ).rejects.toThrow(ScanBlockedError);
    })
  );
});

describe("the escape hatch", () => {
  const previous = process.env.SCAN_ALLOW_PRIVATE_HOSTS;
  beforeEach(() => {
    process.env.SCAN_ALLOW_PRIVATE_HOSTS = "1";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.SCAN_ALLOW_PRIVATE_HOSTS;
    else process.env.SCAN_ALLOW_PRIVATE_HOSTS = previous;
  });

  it("lets the fixture server through when switched on", async () => {
    await expect(
      assertScannableUrl(new URL("http://127.0.0.1:43127/"))
    ).resolves.toBeUndefined();
    expect(() => assertScannableIp("127.0.0.1")).not.toThrow();
  });
});
