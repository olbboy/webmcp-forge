import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestHarness } from "wrangler";

/**
 * Runs the real Worker on workerd through wrangler's test harness, driven from
 * the repo's own vitest. `unstable_dev` is deprecated and
 * @cloudflare/vitest-pool-workers still requires vitest 4 while this repo runs
 * vitest 5, so the harness is the only supported way to test both sides of the
 * publish contract in one suite.
 */

const PUBLISH_TOKEN = "test-publish-token";

/**
 * Same length as the real token, so a request carrying it survives the length
 * check and actually reaches the constant-time comparison. Without this the
 * auth tests pass even against a build that only compares lengths.
 */
const WRONG_TOKEN_SAME_LENGTH = "x".repeat(PUBLISH_TOKEN.length);

let harness: ReturnType<typeof createTestHarness> | undefined;

/**
 * The harness has its own RequestInit, distinct from the DOM one this file is
 * compiled against, and neither declares the `duplex` field that fetch
 * requires for a streamed body.
 */
type WorkerFetchInit = Parameters<
  ReturnType<typeof createTestHarness>["fetch"]
>[1];

function worker() {
  if (!harness) throw new Error("harness not started");
  return harness;
}

/** Any origin works; the harness routes by path, not by host. */
function workerUrl(path: string): string {
  return `https://cdn.test${path}`;
}

/**
 * Each test gets its own id so KV state from an earlier test cannot leak in.
 * Padding with hex digits keeps it matching /^pub_[a-f0-9]{32}$/.
 */
let idCounter = 0;
function nextPublicId(): string {
  idCounter += 1;
  return `pub_${idCounter.toString(16).padStart(32, "0")}`;
}

// The return type is inferred: harness.fetch resolves to the Workers runtime's
// Response, which is not the DOM Response this file is compiled against.
function publish(
  publicId: string,
  body: unknown,
  options: { token?: string | null } = {}
) {
  const token = options.token === undefined ? PUBLISH_TOKEN : options.token;
  return worker().fetch(workerUrl(`/e/${publicId}`), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function bundle(version: number) {
  return {
    version,
    embedJs: `console.log("webmcp-forge v${version}");`,
    manifestJson: JSON.stringify({ name: "webmcp-forge", version }),
  };
}

describe("hosted embed CDN worker", () => {
  beforeAll(async () => {
    harness = createTestHarness({
      workers: [
        {
          config: {
            name: "webmcp-forge-cdn-test",
            main: "cdn/src/index.ts",
            compatibility_date: "2026-09-01",
            kv_namespaces: [{ binding: "EMBEDS", id: "test-embeds" }],
            // The real deployment reads PUBLISH_TOKEN from a wrangler secret.
            // A var is the test-time equivalent of that same binding.
            vars: { PUBLISH_TOKEN },
          },
        },
      ],
    });
    await harness.listen();
  });

  afterAll(async () => {
    // Optional chaining so a failure in beforeAll surfaces its own error
    // instead of a TypeError from here. Skipping close orphans a workerd
    // process on every run.
    await harness?.close();
  });

  it("answers /health", async () => {
    const res = await worker().fetch(workerUrl("/health"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("answers HEAD the same way it answers GET", async () => {
    const health = await worker().fetch(workerUrl("/health"), {
      method: "HEAD",
    });
    expect(health.status).toBe(200);

    const publicId = nextPublicId();
    await publish(publicId, bundle(1));
    const embed = await worker().fetch(workerUrl(`/e/${publicId}/embed.js`), {
      method: "HEAD",
    });
    expect(embed.status).toBe(200);
    expect(embed.headers.get("etag")).toBe('"1"');
    expect(await embed.text()).toBe("");
  });

  it("returns 404 for an unpublished id", async () => {
    const res = await worker().fetch(workerUrl(`/e/${nextPublicId()}/embed.js`));
    expect(res.status).toBe(404);
  });

  it("returns 404 for a malformed id, same as a missing one", async () => {
    const res = await worker().fetch(workerUrl("/e/job_abc123/embed.js"));
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown path", async () => {
    const res = await worker().fetch(workerUrl("/not-a-route"));
    expect(res.status).toBe(404);
  });

  it("returns 405 for a method the route does not serve", async () => {
    const publicId = nextPublicId();
    const post = await worker().fetch(workerUrl(`/e/${publicId}`), {
      method: "POST",
    });
    expect(post.status).toBe(405);

    // The bare id is the write path; there is nothing to read there.
    const get = await worker().fetch(workerUrl(`/e/${publicId}`));
    expect(get.status).toBe(405);
  });

  it("puts CORS headers on errors too, so callers can read the status", async () => {
    const res = await worker().fetch(workerUrl(`/e/${nextPublicId()}/embed.js`));
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("rejects a publish with no token", async () => {
    const res = await publish(nextPublicId(), bundle(1), { token: null });
    expect(res.status).toBe(401);
  });

  it("rejects a publish with a wrong token of a different length", async () => {
    const res = await publish(nextPublicId(), bundle(1), { token: "nope" });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token that is the right length", async () => {
    // Guards the constant-time comparison itself. A build that only checked
    // token length would pass every other auth test in this file.
    const res = await publish(nextPublicId(), bundle(1), {
      token: WRONG_TOKEN_SAME_LENGTH,
    });
    expect(res.status).toBe(401);
  });

  it("rejects an unpublish with no token", async () => {
    const res = await worker().fetch(workerUrl(`/e/${nextPublicId()}`), {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("caps an oversized body that arrives without a declared length", async () => {
    // A streamed request carries no content-length, so only the measured byte
    // count can enforce the cap. This is the branch that catches it.
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(3 * 1024 * 1024)));
        controller.close();
      },
    });
    const res = await worker().fetch(workerUrl(`/e/${nextPublicId()}`), {
      method: "PUT",
      headers: { authorization: `Bearer ${PUBLISH_TOKEN}` },
      body,
      // Required by fetch when the body is a stream.
      duplex: "half",
    } as unknown as WorkerFetchInit);
    expect(res.status).toBe(413);
  });

  it("rejects a malformed body", async () => {
    const res = await worker().fetch(workerUrl(`/e/${nextPublicId()}`), {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${PUBLISH_TOKEN}`,
      },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });

  it("rejects a version that is not a positive integer", async () => {
    const res = await publish(nextPublicId(), { ...bundle(1), version: 0 });
    expect(res.status).toBe(400);
  });

  it("serves embed.js with cache headers after a publish", async () => {
    const publicId = nextPublicId();
    const put = await publish(publicId, bundle(1));
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ publicId, version: 1 });

    const res = await worker().fetch(workerUrl(`/e/${publicId}/embed.js`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/javascript");
    expect(res.headers.get("etag")).toBe('"1"');
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=300, stale-while-revalidate=60"
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toContain("webmcp-forge v1");
  });

  it("serves manifest.json as JSON", async () => {
    const publicId = nextPublicId();
    await publish(publicId, bundle(3));

    const res = await worker().fetch(workerUrl(`/e/${publicId}/manifest.json`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ name: "webmcp-forge", version: 3 });
  });

  it("answers 304 when the caller already holds the current version", async () => {
    const publicId = nextPublicId();
    await publish(publicId, bundle(1));

    const res = await worker().fetch(workerUrl(`/e/${publicId}/embed.js`), {
      headers: { "if-none-match": '"1"' },
    });
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("answers 304 for a weak ETag, which is what Cloudflare forwards", async () => {
    const publicId = nextPublicId();
    await publish(publicId, bundle(1));

    const res = await worker().fetch(workerUrl(`/e/${publicId}/embed.js`), {
      headers: { "if-none-match": 'W/"1"' },
    });
    expect(res.status).toBe(304);
  });

  it("still serves the body when the held version is stale", async () => {
    const publicId = nextPublicId();
    await publish(publicId, bundle(2));

    const res = await worker().fetch(workerUrl(`/e/${publicId}/embed.js`), {
      headers: { "if-none-match": '"1"' },
    });
    expect(res.status).toBe(200);
  });

  it("accepts a repeated publish of the same version", async () => {
    const publicId = nextPublicId();
    expect((await publish(publicId, bundle(1))).status).toBe(200);
    expect((await publish(publicId, bundle(1))).status).toBe(200);
  });

  it("rejects a publish that would move the version backwards", async () => {
    const publicId = nextPublicId();
    await publish(publicId, bundle(2));

    const stale = await publish(publicId, bundle(1));
    expect(stale.status).toBe(409);

    // The stored bundle is untouched.
    const res = await worker().fetch(workerUrl(`/e/${publicId}/embed.js`));
    expect(res.headers.get("etag")).toBe('"2"');
  });

  it("rejects a body over the size cap", async () => {
    const oversized = {
      version: 1,
      embedJs: "x".repeat(3 * 1024 * 1024),
      manifestJson: "{}",
    };
    const res = await publish(nextPublicId(), oversized);
    expect(res.status).toBe(413);
  });

  it("unpublishes, and stays safe when repeated", async () => {
    const publicId = nextPublicId();
    await publish(publicId, bundle(1));

    const first = await worker().fetch(workerUrl(`/e/${publicId}`), {
      method: "DELETE",
      headers: { authorization: `Bearer ${PUBLISH_TOKEN}` },
    });
    expect(first.status).toBe(204);

    const gone = await worker().fetch(workerUrl(`/e/${publicId}/embed.js`));
    expect(gone.status).toBe(404);

    const second = await worker().fetch(workerUrl(`/e/${publicId}`), {
      method: "DELETE",
      headers: { authorization: `Bearer ${PUBLISH_TOKEN}` },
    });
    expect(second.status).toBe(204);
  });
});
