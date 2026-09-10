import { afterEach, describe, expect, it } from "vitest";
import { ScanBlockedError } from "@/lib/net-guard";
import { assertConnectionWasPublic } from "@/lib/scanner";

/**
 * The post-navigation check has two branches and production runs the one the
 * browser-driven tests never reach: Lightpanda reports no peer address, so it
 * re-resolves the redirect chain instead. These drive both branches with stand-
 * in page and response objects, which is the only way to exercise the
 * Lightpanda path without a Lightpanda.
 */

const ENGINE = "SCANNER_ENGINE";
const ENFORCE = "SCAN_ENFORCE_CONNECTED_IP";
const originalEngine = process.env[ENGINE];
const originalEnforce = process.env[ENFORCE];

afterEach(() => {
  if (originalEngine === undefined) delete process.env[ENGINE];
  else process.env[ENGINE] = originalEngine;
  if (originalEnforce === undefined) delete process.env[ENFORCE];
  else process.env[ENFORCE] = originalEnforce;
});

type Hop = { url: () => string; redirectedFrom: () => Hop | null };

function fakePage(url: string) {
  return { url: () => url } as unknown as Parameters<
    typeof assertConnectionWasPublic
  >[0];
}

/** A response whose request chain walks back through `chain`, newest first. */
function fakeResponse(finalUrl: string, chain: string[] = [], serverIp?: string) {
  let head: Hop | null = null;
  for (const url of [...chain].reverse()) {
    const previous: Hop | null = head;
    head = { url: () => url, redirectedFrom: () => previous };
  }
  return {
    url: () => finalUrl,
    serverAddr: async () => (serverIp ? { ipAddress: serverIp, port: 80 } : null),
    request: () => ({ redirectedFrom: () => head }),
  } as unknown as Parameters<typeof assertConnectionWasPublic>[1];
}

describe("under Lightpanda, which reports no peer address", () => {
  function useLightpanda() {
    process.env[ENGINE] = "lightpanda";
    process.env[ENFORCE] = "1";
    delete process.env.SCAN_ALLOW_PRIVATE_HOSTS;
  }

  it("refuses when the chain ends inside the private network", async () => {
    useLightpanda();
    await expect(
      assertConnectionWasPublic(
        fakePage("http://10.0.0.5:9200/"),
        fakeResponse("http://10.0.0.5:9200/", ["http://example.com/"]),
        undefined
      )
    ).rejects.toThrow(ScanBlockedError);
  });

  it("refuses when a middle hop was private, even though the chain ends public", async () => {
    useLightpanda();
    // The peer address of the last response says nothing about where the
    // browser has already been. This is the shape the Chrome branch cannot see
    // and the reason this branch walks the whole chain.
    await expect(
      assertConnectionWasPublic(
        fakePage("http://8.8.8.8/collect"),
        fakeResponse("http://8.8.8.8/collect", [
          "http://example.com/",
          "http://192.168.1.1/admin",
        ]),
        undefined
      )
    ).rejects.toThrow(ScanBlockedError);
  });

  it("allows a chain that stayed public throughout", async () => {
    useLightpanda();
    await expect(
      assertConnectionWasPublic(
        fakePage("http://8.8.8.8/"),
        fakeResponse("http://8.8.8.8/", ["http://1.1.1.1/"]),
        undefined
      )
    ).resolves.toBeUndefined();
  });

  it("allows the app's own origin, which is what the demo button scans", async () => {
    useLightpanda();
    // Without this the demo shop is refused in development, where the app
    // answers on localhost.
    await expect(
      assertConnectionWasPublic(
        fakePage("http://127.0.0.1:43127/fixture-shop/index.html"),
        fakeResponse("http://127.0.0.1:43127/fixture-shop/index.html"),
        "http://127.0.0.1:43127"
      )
    ).resolves.toBeUndefined();
  });
});

describe("under Chrome, which does report one", () => {
  function useChrome() {
    process.env[ENGINE] = "chrome";
    process.env[ENFORCE] = "1";
    delete process.env.SCAN_ALLOW_PRIVATE_HOSTS;
  }

  it("refuses the address the browser actually dialled", async () => {
    useChrome();
    await expect(
      assertConnectionWasPublic(
        fakePage("http://totally-public.example/"),
        fakeResponse("http://totally-public.example/", [], "127.0.0.1"),
        undefined
      )
    ).rejects.toThrow(ScanBlockedError);
  });

  it("refuses when no address came back at all", async () => {
    useChrome();
    // Something answered and we cannot say what. That is the case this check
    // exists for, so it is not a pass.
    await expect(
      assertConnectionWasPublic(
        fakePage("http://public.example/"),
        fakeResponse("http://public.example/"),
        undefined
      )
    ).rejects.toThrow(ScanBlockedError);
  });

  it("allows a public peer address", async () => {
    useChrome();
    await expect(
      assertConnectionWasPublic(
        fakePage("http://public.example/"),
        fakeResponse("http://public.example/", [], "8.8.8.8"),
        undefined
      )
    ).resolves.toBeUndefined();
  });
});

describe("the kill switch", () => {
  it("lets everything through when switched off", async () => {
    process.env[ENGINE] = "lightpanda";
    process.env[ENFORCE] = "0";
    await expect(
      assertConnectionWasPublic(
        fakePage("http://10.0.0.5/"),
        fakeResponse("http://10.0.0.5/"),
        undefined
      )
    ).resolves.toBeUndefined();
  });
});
