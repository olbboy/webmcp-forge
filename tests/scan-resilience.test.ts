import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { POST as scanPost } from "@/app/api/scan/route";
import { closeBrowser, getBrowser } from "@/lib/scanner";

/**
 * Two ways a scan used to go wrong beyond the page it was on: one linked page
 * redirecting somewhere it should not took the whole scan with it, and a
 * browser that never arrived left the request waiting with nothing to stop it.
 */

const VARS = [
  "SCAN_ALLOW_PRIVATE_HOSTS",
  "SCAN_ENFORCE_CONNECTED_IP",
  "SCANNER_ENGINE",
  "SCANNER_CDP_URL",
  "BROWSER_ACQUIRE_TIMEOUT_MS",
];
const original = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));

afterEach(async () => {
  for (const v of VARS) {
    if (original[v] === undefined) delete process.env[v];
    else process.env[v] = original[v] as string;
  }
  await closeBrowser();
});

function startServer(handler: http.RequestListener) {
  return new Promise<{ url: string; port: number; close: () => Promise<void> }>(
    (resolve, reject) => {
      const server = http.createServer(handler);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("failed to bind"));
          return;
        }
        resolve({
          url: `http://127.0.0.1:${address.port}`,
          port: address.port,
          close: () =>
            new Promise<void>((done, fail) =>
              server.close((err) => (err ? fail(err) : done()))
            ),
        });
      });
    }
  );
}

describe("a linked page that redirects out of bounds", () => {
  it("costs that page and not the scan", async () => {
    const internal = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>Internal</title><h1>secrets</h1>");
    });
    const site = await startServer((req, res) => {
      if (req.url === "/detour") {
        res.writeHead(302, { location: `${internal.url}/` });
        res.end();
        return;
      }
      if (req.url === "/catalog") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<title>Catalog</title><h1>Catalog</h1><p>Real content</p>");
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<title>Shop</title><nav><a href="/catalog">Catalog</a><a href="/detour">Detour</a></nav>`
      );
    });

    try {
      // The pre-flight check is off so the fixture is reachable at all, and the
      // post-navigation check is on so the detour is refused. The site's own
      // pages are exempt from it by origin, which is what leaves exactly one
      // page for the check to object to.
      process.env.SCAN_ALLOW_PRIVATE_HOSTS = "1";
      process.env.SCAN_ENFORCE_CONNECTED_IP = "1";

      const res = await scanPost(
        new Request("http://scanner.test/api/scan", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            host: `127.0.0.1:${site.port}`,
          },
          body: JSON.stringify({ url: `${site.url}/` }),
        })
      );

      expect(res.status, "the scan as a whole still succeeds").toBe(200);
      const job = (await res.json()) as {
        pages: Array<{ url: string; title: string; error?: string }>;
        candidates: Array<{ name: string }>;
      };

      const detour = job.pages.find((p) => p.url.includes("/detour"));
      expect(detour, "the refused page is still recorded").toBeTruthy();
      expect(detour?.error).toMatch(/cannot be scanned/i);
      expect(detour?.title, "and nothing was read from it").toBe("");

      const catalog = job.pages.find((p) => p.url.includes("/catalog"));
      expect(catalog?.title, "the page beside it came through").toMatch(
        /Catalog/
      );
      expect(job.candidates.length).toBeGreaterThan(0);
    } finally {
      await site.close();
      await internal.close();
    }
  });
});

describe("a browser that never arrives", () => {
  it("gives up instead of waiting forever", async () => {
    // A socket that accepts and then says nothing: connecting over CDP to this
    // hangs, which is the one wait on the scan path with no timeout of its own.
    // Left alone it held the request and the concurrency slot with it.
    const open: net.Socket[] = [];
    const silent = net.createServer((socket) => {
      // Held, not answered. `net.Server.close` waits for open connections to
      // end, so the sockets have to be destroyed by hand afterwards.
      open.push(socket);
    });
    await new Promise<void>((resolve) =>
      silent.listen(0, "127.0.0.1", () => resolve())
    );
    const address = silent.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      process.env.SCANNER_ENGINE = "lightpanda";
      process.env.SCANNER_CDP_URL = `http://127.0.0.1:${port}`;
      process.env.BROWSER_ACQUIRE_TIMEOUT_MS = "1500";

      const started = Date.now();
      await expect(getBrowser()).rejects.toThrow(/No browser available/);
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      // `close` alone waits for open connections to end, and the browser client
      // is still holding one — the very thing this test set up.
      for (const socket of open) socket.destroy();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });
});
