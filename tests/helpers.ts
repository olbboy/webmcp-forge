import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const FIXTURE_ROOT = path.join(process.cwd(), "public", "fixture-shop");

export function startFixtureServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/") rel = "/index.html";
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.normalize(path.join(FIXTURE_ROOT, rel));
      if (!file.startsWith(FIXTURE_ROOT)) {
        res.statusCode = 403;
        res.end("forbidden");
        return;
      }
      if (!existsSync(file) || statSync(file).isDirectory()) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      const ext = path.extname(file);
      const types: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".txt": "text/plain; charset=utf-8",
        ".json": "application/json; charset=utf-8",
      };
      res.setHeader("content-type", types[ext] || "application/octet-stream");
      createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind fixture server"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

export function unwrapToolResult(result: unknown): Record<string, unknown> {
  if (result && typeof result === "object") {
    const rec = result as Record<string, unknown>;
    if (rec.data && typeof rec.data === "object") {
      return rec.data as Record<string, unknown>;
    }
    const content = rec.content;
    if (Array.isArray(content) && content[0] && typeof content[0] === "object") {
      const text = (content[0] as { text?: unknown }).text;
      if (typeof text === "string") {
        try {
          return JSON.parse(text) as Record<string, unknown>;
        } catch {
          return { text };
        }
      }
    }
  }
  return { value: result };
}
