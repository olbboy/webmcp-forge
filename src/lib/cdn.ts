import { createKeyQueue } from "./key-queue";

/**
 * Client for the hosted-embed CDN Worker in `cdn/`.
 *
 * Configuration is read on every call rather than cached at module load, so a
 * deployment can add or remove the CDN without a rebuild and so tests can stub
 * the environment per case.
 */

const PUBLISH_TIMEOUT_MS = 10_000;

/** Enough of the Worker's error body to diagnose a failure, never more. */
const ERROR_DETAIL_LIMIT = 200;

export const CDN_NOT_CONFIGURED = "CDN is not configured";

function baseUrl(): string | null {
  const raw = process.env.CDN_BASE_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

function publishToken(): string | null {
  const raw = process.env.CDN_PUBLISH_TOKEN?.trim();
  return raw ? raw : null;
}

export function isCdnConfigured(): boolean {
  return baseUrl() !== null && publishToken() !== null;
}

export function hostedUrls(publicId: string): {
  embed: string;
  manifest: string;
} {
  const base = baseUrl();
  if (!base) throw new Error(CDN_NOT_CONFIGURED);
  return {
    embed: `${base}/e/${publicId}/embed.js`,
    manifest: `${base}/e/${publicId}/manifest.json`,
  };
}

export type PublishInput = {
  publicId: string;
  version: number;
  embedJs: string;
  manifestJson: string;
  /** Customer site origin. Useful for support; not a secret. */
  jobOrigin?: string;
};

/**
 * `superseded` means the CDN already holds a bundle at least as new as the one
 * this call carried, either because a newer publish overtook it here or
 * because the Worker rejected it as stale. It is a success, not a failure.
 */
export type PublishOutcome = "published" | "superseded";

const runSerialized = createKeyQueue();

/**
 * Newest version anyone has asked to publish, per public id.
 *
 * Kept for the life of the process rather than only while a write is in
 * flight. A retry can spend several awaits reading the job and its artifacts
 * before it reaches this module, and a newer publish can start and finish in
 * that gap; forgetting the high-water mark would let the retry through and
 * revert the bundle. One integer per published job is a cheap price.
 */
const newestRequested = new Map<string, number>();

async function describeFailure(
  action: string,
  response: Response
): Promise<string> {
  let detail = "";
  try {
    detail = (await response.text()).slice(0, ERROR_DETAIL_LIMIT);
  } catch {
    // A body we cannot read still leaves us the status, which is the useful
    // half of the message.
  }
  return `CDN ${action} failed: ${response.status} ${detail}`.trim();
}

async function send(
  method: "PUT" | "DELETE",
  publicId: string,
  body?: unknown
): Promise<Response> {
  const base = baseUrl();
  const token = publishToken();
  if (!base || !token) throw new Error(CDN_NOT_CONFIGURED);

  return fetch(`${base}/e/${publicId}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
  });
}

function isStale(publicId: string, version: number): boolean {
  return version < (newestRequested.get(publicId) ?? 0);
}

export async function publishEmbed(
  input: PublishInput
): Promise<PublishOutcome> {
  const { publicId, version } = input;

  // Drop a retry that is already behind. The Worker's own version guard reads
  // through a KV cache that can be up to a minute stale, so sending this
  // anyway could silently revert a newer bundle.
  if (isStale(publicId, version)) return "superseded";
  newestRequested.set(publicId, version);

  return runSerialized(publicId, async () => {
    // Re-check: a newer publish may have been requested while this one waited
    // its turn in the queue.
    if (isStale(publicId, version)) return "superseded";

    const response = await send("PUT", publicId, {
      embedJs: input.embedJs,
      manifestJson: input.manifestJson,
      version,
      jobOrigin: input.jobOrigin,
    });

    // The Worker rejects a backwards version with 409. That means the hosted
    // bundle is already newer, which is the same end state we wanted.
    if (response.status === 409) return "superseded";
    if (!response.ok) {
      throw new Error(await describeFailure("publish", response));
    }
    return "published";
  });
}

export async function unpublishEmbed(publicId: string): Promise<void> {
  await runSerialized(publicId, async () => {
    const response = await send("DELETE", publicId);
    // Already gone is the state we asked for.
    if (response.status === 404) return;
    if (!response.ok) {
      throw new Error(await describeFailure("unpublish", response));
    }
  });
  // Nothing is stored any more, so a later publish must not be judged against
  // the versions that came before this point.
  newestRequested.delete(publicId);
}
