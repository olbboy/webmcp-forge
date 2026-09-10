import { readdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { POST as scanPost } from "@/app/api/scan/route";
import { closeBrowser } from "@/lib/scanner";

/**
 * Reproduces the three ways a scan reached the private network before the
 * guards existed. Each case switches on exactly the guard it is about: sharing
 * one switch is how a test for the second guard ends up passing because the
 * first one refused, and still passing after the second one is deleted.
 */

const HATCH = "SCAN_ALLOW_PRIVATE_HOSTS";
const ENFORCE = "SCAN_ENFORCE_CONNECTED_IP";

function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

const originalHatch = process.env[HATCH];
const originalEnforce = process.env[ENFORCE];

/** Only the pre-flight DNS check is live. */
function onlyPreflight() {
  setEnv(HATCH, undefined);
  setEnv(ENFORCE, "0");
}

/** Only the post-navigation check is live. */
function onlyPostNavigation() {
  setEnv(HATCH, "1");
  setEnv(ENFORCE, "1");
}

function startServer(
  handler: http.RequestListener
): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
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
  });
}

async function countJobs(): Promise<number> {
  const dir = path.join(process.env.WEBMCP_DATA_DIR as string, "jobs");
  try {
    return (await readdir(dir)).filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

function scan(url: string, origin = "http://scanner.test") {
  return scanPost(
    new Request(`${origin}/api/scan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    })
  );
}

afterEach(() => {
  setEnv(HATCH, originalHatch);
  setEnv(ENFORCE, originalEnforce);
});

afterAll(async () => {
  await closeBrowser();
});

describe("the pre-flight check", () => {
  it("refuses a literal private address, and writes no job for it", async () => {
    onlyPreflight();
    const before = await countJobs();

    const res = await scan("http://127.0.0.1:9/");

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/cannot be scanned/i);
    // A refused probe must leave nothing behind. A job per attempt would fill
    // the volume the daily backup archives.
    expect(await countJobs()).toBe(before);
  });

  it("refuses the cloud metadata address", async () => {
    onlyPreflight();
    const res = await scan("http://169.254.169.254/");
    expect(res.status).toBe(400);
  });

  it("refuses a public hostname that resolves to loopback", async () => {
    onlyPreflight();
    // localtest.me is a real public name whose A record is 127.0.0.1 — the
    // shape that defeats any check reading the URL string rather than the
    // address behind it.
    const res = await scan("http://localtest.me/");
    expect(res.status).toBe(400);
  });

  it("still allows the app's own origin, which is what the demo button uses", async () => {
    onlyPreflight();
    const fixture = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>Demo</title><h1>Demo</h1>");
    });
    try {
      const res = await scan(`${fixture.url}/`, fixture.url);
      expect(res.status).toBe(200);
    } finally {
      await fixture.close();
    }
  });
});

describe("the post-navigation check", () => {
  it("refuses a redirect that lands on a private address", async () => {
    const internal = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>Internal admin</title><h1>secrets</h1>");
    });
    const redirector = await startServer((_req, res) => {
      res.writeHead(302, { location: `${internal.url}/` });
      res.end();
    });
    try {
      // The pre-flight check is off, so anything that refuses here can only be
      // the post-navigation one. Without this separation the case proves
      // nothing: both servers are on loopback, and the pre-flight check would
      // stop the request before a browser ever opened it.
      onlyPostNavigation();
      const res = await scan(`${redirector.url}/`);

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/cannot be scanned/i);
    } finally {
      await redirector.close();
      await internal.close();
    }
  });

  it("does not refuse when it is switched off, proving the case above tests it", async () => {
    const internal = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>Internal admin</title><h1>secrets</h1>");
    });
    const redirector = await startServer((_req, res) => {
      res.writeHead(302, { location: `${internal.url}/` });
      res.end();
    });
    try {
      setEnv(HATCH, "1");
      setEnv(ENFORCE, "0");
      const res = await scan(`${redirector.url}/`);
      expect(res.status).toBe(200);
    } finally {
      await redirector.close();
      await internal.close();
    }
  });
});

describe("robots.txt", () => {
  it("does not follow a redirect into the private network", async () => {
    let internalHits = 0;
    const internal = await startServer((_req, res) => {
      internalHits += 1;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("User-agent: *\nDisallow: /");
    });
    const site = await startServer((req, res) => {
      if (req.url === "/robots.txt") {
        res.writeHead(302, { location: `${internal.url}/robots.txt` });
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<title>Site</title><h1>Site</h1>");
    });
    try {
      // The site itself is reachable (hatch on); only the redirect target is
      // the thing under test, and the post-navigation check is off so it
      // cannot be the one that intervenes.
      setEnv(HATCH, "1");
      setEnv(ENFORCE, "0");
      const res = await scan(`${site.url}/`);

      expect(res.status).toBe(200);
      // The redirect pointed at a service that was never contacted. Node's
      // fetch would have followed it on the default settings.
      expect(internalHits).toBe(0);
    } finally {
      await site.close();
      await internal.close();
    }
  });
});
