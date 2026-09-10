import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { closeBrowser, getBrowser, scanSite } from "@/lib/scanner";
import { startFixtureServer } from "./helpers";

/**
 * The scanner keeps one browser and reuses it, which is worth a few hundred
 * megabytes only while scans keep arriving. This file pins the other half of
 * that bargain: the browser has to go away once it stops being used.
 *
 * Its own file because it deliberately closes the shared browser, which would
 * surprise any test running after it.
 */

const IDLE_MS = 400;

describe("shared browser lifetime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await closeBrowser();
  });

  it("shuts the browser down after a spell with no scans", async () => {
    vi.stubEnv("BROWSER_IDLE_MS", String(IDLE_MS));
    const fixture = await startFixtureServer();
    try {
      const browser = await getBrowser();
      expect(browser.isConnected()).toBe(true);

      await scanSite(`${fixture.url}/index.html`);
      // Still up the moment the scan returns: closing it here would make the
      // next scan pay for a fresh launch.
      expect(browser.isConnected()).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 3));
      expect(browser.isConnected()).toBe(false);
    } finally {
      await fixture.close();
    }
  });

  it("keeps the browser while a scan is still running", async () => {
    vi.stubEnv("BROWSER_IDLE_MS", String(IDLE_MS));
    const fixture = await startFixtureServer();
    try {
      const browser = await getBrowser();
      const url = `${fixture.url}/index.html`;

      // Two overlapping scans: the first finishing must not pull the browser
      // out from under the second.
      const [first, second] = await Promise.all([
        scanSite(url),
        scanSite(url),
      ]);

      expect(first.candidates.length).toBeGreaterThan(0);
      expect(second.candidates.length).toBeGreaterThan(0);
      expect(browser.isConnected()).toBe(true);
    } finally {
      await fixture.close();
    }
  });

  it("serves a scan that starts while the browser is being closed", async () => {
    const fixture = await startFixtureServer();
    try {
      await getBrowser();

      // The idle timer fires on its own schedule, so a scan can arrive in the
      // middle of a teardown. It has to get a working browser, not the one on
      // its way out.
      const closing = closeBrowser();
      const result = await scanSite(`${fixture.url}/index.html`);
      await closing;

      expect(result.candidates.length).toBeGreaterThan(0);
    } finally {
      await fixture.close();
    }
  });

  it("launches a fresh browser after the idle shutdown", async () => {
    vi.stubEnv("BROWSER_IDLE_MS", String(IDLE_MS));
    const fixture = await startFixtureServer();
    try {
      const first = await getBrowser();
      await scanSite(`${fixture.url}/index.html`);
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS * 3));
      expect(first.isConnected()).toBe(false);

      // The point of shutting down is that the next request still works.
      const result = await scanSite(`${fixture.url}/index.html`);
      expect(result.candidates.length).toBeGreaterThan(0);
      const second = await getBrowser();
      expect(second).not.toBe(first);
      expect(second.isConnected()).toBe(true);
    } finally {
      await fixture.close();
    }
  });
});
