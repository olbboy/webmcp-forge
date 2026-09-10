import { isAuthorized } from "./auth";
import {
  deleteRecord,
  getRecord,
  putRecord,
  READ_CACHE_TTL_SECONDS,
  type CdnRecord,
  type Env,
} from "./kv";

/**
 * Public ids are minted by Forge as `pub_` + 32 hex characters (128 bits).
 * They are deliberately not job ids: a job id is the owner's admin key, and a
 * hosted embed URL is visible in the page source of every customer site.
 */
const PUBLIC_ID_PATTERN = /^pub_[a-f0-9]{32}$/;

/** Real bundles are tens of kilobytes. This only stops abuse. */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const EMBED_FILE = "embed.js";

/** `/e/{publicId}` for writes, `/e/{publicId}/{file}` for public reads. */
const EMBED_ROUTE = /^\/e\/([^/]+)(?:\/(embed\.js|manifest\.json))?$/;

/**
 * Present on every response, including errors. Forge and any tooling that
 * inspects a published manifest read these cross-origin, and a CORS failure
 * would hide the status code behind a generic network error.
 */
function baseHeaders(contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
  };
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: baseHeaders("application/json; charset=utf-8"),
  });
}

/**
 * Headers for a public read. `max-age` is 5 minutes because the file is
 * immutable between publishes and a regenerate already costs up to 60 seconds
 * of KV propagation.
 */
function publicHeaders(contentType: string, version: number): Headers {
  return new Headers({
    ...baseHeaders(contentType),
    "cache-control": "public, max-age=300, stale-while-revalidate=60",
    etag: `"${version}"`,
  });
}

/**
 * Cloudflare rewrites a strong ETag into a weak one whenever it re-compresses
 * a response, which it does here because the bundle leaves this Worker
 * uncompressed. Comparing the raw header would then never match, so every
 * revalidation would re-send the whole bundle instead of answering 304.
 * https://developers.cloudflare.com/cache/reference/etag-headers/
 */
function normalizeEtag(value: string): string {
  return value.startsWith("W/") ? value.slice(2) : value;
}

function matchesEtag(header: string | null, etag: string | null): boolean {
  if (!header || !etag) return false;
  // A conditional request may carry a comma-separated list of candidates.
  return header
    .split(",")
    .some((candidate) => normalizeEtag(candidate.trim()) === etag);
}

async function serveFile(
  env: Env,
  publicId: string,
  file: string,
  request: Request
): Promise<Response> {
  const record = await getRecord(env, publicId, {
    cacheTtl: READ_CACHE_TTL_SECONDS,
  });
  if (!record) return jsonError("Not found", 404);

  const isEmbed = file === EMBED_FILE;
  const headers = publicHeaders(
    isEmbed
      ? "application/javascript; charset=utf-8"
      : "application/json; charset=utf-8",
    record.version
  );

  // A browser revalidating an expired cache entry sends the version it holds.
  // Answering 304 saves re-sending an unchanged bundle.
  if (matchesEtag(request.headers.get("if-none-match"), headers.get("etag"))) {
    return new Response(null, { status: 304, headers });
  }

  // HEAD carries the same headers as GET but no body. Uptime monitors default
  // to HEAD, and a resource that answers GET is expected to answer HEAD too.
  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  return new Response(isEmbed ? record.embedJs : record.manifestJson, {
    status: 200,
    headers,
  });
}

type PublishBody = {
  embedJs?: unknown;
  manifestJson?: unknown;
  version?: unknown;
  jobOrigin?: unknown;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

async function handlePublish(
  request: Request,
  env: Env,
  publicId: string
): Promise<Response> {
  if (!isAuthorized(request, env)) return jsonError("Unauthorized", 401);

  // Fast path: reject an oversized upload before buffering it. Not every
  // client sends content-length for a string body — wrangler's own test
  // harness does not — so this cannot be made mandatory without breaking
  // legitimate publishes.
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) {
    return jsonError("Payload too large", 413);
  }

  // The authoritative check. content-length is client-supplied and absent on a
  // chunked request, so the real byte count is what the cap is enforced on.
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return jsonError("Payload too large", 413);
  }

  let body: PublishBody;
  try {
    body = JSON.parse(rawBody) as PublishBody;
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const { embedJs, manifestJson, version, jobOrigin } = body;
  if (!isNonEmptyString(embedJs) || !isNonEmptyString(manifestJson)) {
    return jsonError("embedJs and manifestJson are required", 400);
  }
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    return jsonError("version must be a positive integer", 400);
  }

  // Reject a publish that would move the bundle backwards, which is what a
  // delayed retry looks like. Equal versions are allowed so that retrying the
  // same publish stays idempotent.
  //
  // The guard has a real hole. KV caches reads per location for 60 seconds by
  // default, so a retry arriving inside that window can read a version older
  // than the one already stored and be waved through, silently reverting the
  // bundle. Forge must abandon a pending retry once a newer generate starts
  // rather than lean on this check for ordering.
  const existing = await getRecord(env, publicId);
  if (existing && version < existing.version) {
    return jsonError(
      `Stale version ${version}; stored version is ${existing.version}`,
      409
    );
  }

  const record: CdnRecord = {
    publicId,
    version,
    embedJs,
    manifestJson,
    updatedAt: new Date().toISOString(),
    ...(isNonEmptyString(jobOrigin) ? { jobOrigin } : {}),
  };
  await putRecord(env, record);

  return new Response(JSON.stringify({ publicId, version }), {
    status: 200,
    headers: baseHeaders("application/json; charset=utf-8"),
  });
}

async function handleUnpublish(
  request: Request,
  env: Env,
  publicId: string
): Promise<Response> {
  if (!isAuthorized(request, env)) return jsonError("Unauthorized", 401);
  // Deleting an absent key is not an error: unpublish is a desired end state,
  // not a transaction, so retries must stay safe.
  await deleteRecord(env, publicId);
  return new Response(null, { status: 204 });
}

function isReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === "/health") {
    if (!isReadMethod(request.method)) {
      return jsonError("Method not allowed", 405);
    }
    return new Response(request.method === "HEAD" ? null : "ok", {
      headers: baseHeaders("text/plain; charset=utf-8"),
    });
  }

  const match = EMBED_ROUTE.exec(pathname);
  if (!match) return jsonError("Not found", 404);

  const publicId = match[1];
  const file = match[2];

  // A malformed id is answered exactly like a missing one, so probing cannot
  // distinguish "wrong shape" from "not published".
  if (!PUBLIC_ID_PATTERN.test(publicId)) return jsonError("Not found", 404);

  if (file) {
    if (!isReadMethod(request.method)) {
      return jsonError("Method not allowed", 405);
    }
    return serveFile(env, publicId, file, request);
  }

  if (request.method === "PUT") return handlePublish(request, env, publicId);
  if (request.method === "DELETE") {
    return handleUnpublish(request, env, publicId);
  }
  return jsonError("Method not allowed", 405);
}

/** The Worker entry point workerd invokes for every incoming request. */
const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      // KV throws on its own limits — the free plan allows 1,000 writes a day
      // and one write per second to a single key — and on transient faults.
      // Forge parses every response body as JSON to decide publishStatus, so
      // letting this fall through to workerd's default HTML error page would
      // break its failure handling.
      console.error(
        "webmcp-forge-cdn:",
        error instanceof Error ? error.message : String(error)
      );
      return jsonError("Storage unavailable", 503);
    }
  },
};

export default worker;
