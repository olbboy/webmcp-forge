/**
 * KV access for the hosted-embed CDN Worker.
 *
 * The KVNamespace type below is a narrow hand-written shim rather than
 * @cloudflare/workers-types. That keeps `cdn/` inside the repo's single
 * TypeScript program (the Next.js tsconfig) instead of adding a second
 * toolchain for ~150 lines of Worker code. It declares only the three calls
 * this Worker makes. Swap it for the real types if the Worker grows.
 */
export type KVNamespace = {
  get(key: string, options?: { cacheTtl?: number }): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
};

export type Env = {
  EMBEDS: KVNamespace;
  /** Shared secret with Forge. Set via `wrangler secret put PUBLISH_TOKEN`. */
  PUBLISH_TOKEN?: string;
};

export type CdnRecord = {
  publicId: string;
  /** Monotonic integer, bumped by Forge on every generate. Starts at 1. */
  version: number;
  embedJs: string;
  manifestJson: string;
  /** ISO timestamp of the last successful publish. */
  updatedAt: string;
  /** Origin of the customer site. Useful for support; never a secret. */
  jobOrigin?: string;
};

/**
 * Reads are served from Cloudflare's edge cache for this long. KV itself takes
 * up to 60 seconds to propagate a write globally, so a shorter TTL would not
 * make new versions arrive any faster.
 */
export const READ_CACHE_TTL_SECONDS = 60;

function keyFor(publicId: string): string {
  return `embed:${publicId}`;
}

export async function getRecord(
  env: Env,
  publicId: string,
  options?: { cacheTtl?: number }
): Promise<CdnRecord | null> {
  const raw = await env.EMBEDS.get(keyFor(publicId), options);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A record we cannot parse is unusable. Treat it as missing so a caller
    // sees a clean 404 instead of a 500, and so a re-publish can fix it.
    return null;
  }
  // Valid JSON of the wrong shape is just as unusable, and worse: serving it
  // would cache an empty bundle at the edge for five minutes.
  if (!isCdnRecord(parsed)) return null;
  return parsed;
}

function isCdnRecord(value: unknown): value is CdnRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === "number" &&
    typeof record.embedJs === "string" &&
    typeof record.manifestJson === "string"
  );
}

export async function putRecord(env: Env, record: CdnRecord): Promise<void> {
  await env.EMBEDS.put(keyFor(record.publicId), JSON.stringify(record));
}

export async function deleteRecord(env: Env, publicId: string): Promise<void> {
  await env.EMBEDS.delete(keyFor(publicId));
}
