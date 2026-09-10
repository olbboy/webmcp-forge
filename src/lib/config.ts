export const MAX_PAGES = 8;
export const PAGE_TIMEOUT_MS = 15_000;
export const SCAN_TIMEOUT_MS = 45_000;
/**
 * How long the shared browser may sit unused before it is shut down. Chrome
 * costs a few hundred megabytes, and this server shares a small box with other
 * work, so an idle browser is memory taken from a neighbour for nothing.
 */
export const BROWSER_IDLE_MS = 5 * 60_000;

/**
 * Which browser the scanner drives.
 *
 * `chrome` launches a real Chrome in this process. `lightpanda` connects over
 * the Chrome DevTools Protocol to a Lightpanda server, which uses roughly a
 * twentieth of the memory because it has no rendering engine. The scanner only
 * ever reads the DOM, so that missing half costs it nothing.
 */
export type ScannerEngine = "chrome" | "lightpanda";

/** Chrome until Lightpanda has a stable release to pin. */
export const DEFAULT_SCANNER_ENGINE: ScannerEngine = "chrome";

/** Where a Lightpanda server listens when nothing else is configured. */
export const DEFAULT_SCANNER_CDP_URL = "http://127.0.0.1:9222";
export const ROBOTS_TIMEOUT_MS = 3_000;
export const LOCAL_RELAY_SRC =
  "https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@latest/dist/browser/embed.js";
export const POLYFILL_CDN =
  "https://unpkg.com/@mcp-b/webmcp-polyfill@latest/dist/index.iife.js";
export const USER_AGENT = "WebMCPForgeBot/1.0 (+https://webmcp.forge)";
