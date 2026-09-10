import { afterEach, describe, expect, it, vi } from "vitest";
import { getBrowser, selectedEngine } from "@/lib/scanner";

/**
 * Which browser the scanner drives is a deployment setting, and getting it
 * wrong should be loud. These cover the choice itself; the two engines are
 * compared for extraction fidelity in
 * plans/reports/research-260910-2125-lightpanda-thay-chrome.md.
 */

describe("scanner engine selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Chrome when nothing is configured", () => {
    vi.stubEnv("SCANNER_ENGINE", "");
    expect(selectedEngine()).toBe("chrome");
  });

  it("accepts either engine, however it is cased or spaced", () => {
    vi.stubEnv("SCANNER_ENGINE", "chrome");
    expect(selectedEngine()).toBe("chrome");

    vi.stubEnv("SCANNER_ENGINE", "  LightPanda  ");
    expect(selectedEngine()).toBe("lightpanda");
  });

  it("refuses an engine it does not know", () => {
    vi.stubEnv("SCANNER_ENGINE", "firefox");
    // Quietly scanning with the wrong browser is harder to notice than a
    // startup error, so this throws rather than falling back.
    expect(() => selectedEngine()).toThrow(/firefox/);
    expect(() => selectedEngine()).toThrow(/chrome/);
  });

  it("names the address when Lightpanda cannot be reached", async () => {
    vi.stubEnv("SCANNER_ENGINE", "lightpanda");
    // Port 1 is reserved and nothing listens there, so the connection fails
    // immediately rather than waiting out a timeout.
    vi.stubEnv("SCANNER_CDP_URL", "http://127.0.0.1:1");

    // The message has to say this was a deployment problem, not a bad site.
    await expect(getBrowser()).rejects.toThrow(/Lightpanda is not reachable/);
    await expect(getBrowser()).rejects.toThrow(/127\.0\.0\.1:1/);
  });
});
