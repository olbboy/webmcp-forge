import {
  CDN_NOT_CONFIGURED,
  hostedUrls,
  isCdnConfigured,
  publishEmbed,
  unpublishEmbed,
} from "./cdn";
import { applySelection, buildManifest, generateEmbedJs } from "./generator";
import { createKeyQueue } from "./key-queue";
import { ScanBlockedError, assertScannableUrl } from "./net-guard";
import { parseScanUrl, scanSite } from "./scanner";
import { getJob, readArtifact, saveArtifact, saveJob } from "./store";
import type { ScanJob, SelectedTool } from "./types";

const EMBED_FILENAME = "webmcp-forge.embed.js";
const MANIFEST_FILENAME = "webmcp-forge.manifest.json";

/**
 * An error a client caused and can act on. Anything else that escapes these
 * functions is a server fault whose message may carry a filesystem path, so
 * routes must not repeat it back.
 */
export class JobError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "JobError";
  }
}

/**
 * Serializes every read-modify-write of one job. The store is a JSON file with
 * no locking, so two concurrent generates would each read the same version,
 * mint their own public id, and leave one bundle live on the CDN that the job
 * no longer remembers and therefore can never unpublish.
 */
const runForJob = createKeyQueue();

export function newJobId(): string {
  return `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/**
 * The identity that appears in a public embed URL. Kept separate from the job
 * id, which doubles as the owner's unauthenticated admin key: publishing must
 * not hand every visitor of a customer site the ability to edit the job.
 * 32 hex characters, matching the Worker's `/^pub_[a-f0-9]{32}$/`.
 */
export function newPublicId(): string {
  return `pub_${crypto.randomUUID().replace(/-/g, "")}`;
}

/** The publish-facing view of a job, shared by all three write routes. */
export function publishSummary(job: ScanJob) {
  return {
    id: job.id,
    status: job.status,
    version: job.version,
    publicId: job.publicId,
    publishStatus: job.publishStatus,
    publishedVersion: job.publishedVersion,
    publishedAt: job.publishedAt,
    publishError: job.publishError,
    hostedEmbedUrl: job.hostedEmbedUrl,
    hostedManifestUrl: job.hostedManifestUrl,
  };
}

/**
 * Runs a scan and records it as a job.
 *
 * `selfOrigin` is the address this app is answering on. The "Try the demo
 * shop" button asks for a URL on that origin, which in development is
 * localhost — an address the guard below otherwise refuses. Scanning yourself
 * is not server-side request forgery.
 */
export async function runScan(
  rawUrl: string,
  selfOrigin?: string
): Promise<ScanJob> {
  const target = parseScanUrl(rawUrl);
  // Before the job exists, not after. A refused URL should leave nothing
  // behind: a file per probe attempt would fill the volume the daily backup
  // archives, and a job is the wrong record for a request that never ran.
  await assertScannableUrl(target, { selfOrigin });
  const now = new Date().toISOString();
  const id = newJobId();
  const pending: ScanJob = {
    id,
    url: rawUrl.trim(),
    origin: new URL(rawUrl.trim()).origin,
    status: "scanning",
    createdAt: now,
    updatedAt: now,
    pages: [],
    candidates: [],
    includeLocalRelay: false,
  };
  await saveJob(pending);

  try {
    const result = await scanSite(rawUrl);
    const ready: ScanJob = {
      ...pending,
      url: result.url,
      origin: result.origin,
      status: "ready",
      updatedAt: new Date().toISOString(),
      pages: result.pages,
      candidates: result.candidates,
      robotsDisallowAll: result.robotsDisallowAll,
    };
    await saveJob(ready);
    return ready;
  } catch (err) {
    // A blocked address is the caller's mistake, not a failed scan. Recording
    // it as a job would answer 422 with a job object; letting it out reaches
    // the route's own handler and answers 400 with nothing attached.
    if (err instanceof ScanBlockedError) throw err;
    const failed: ScanJob = {
      ...pending,
      status: "error",
      updatedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    };
    await saveJob(failed);
    return failed;
  }
}

async function requireJob(id: string): Promise<ScanJob> {
  const job = await getJob(id);
  if (!job) throw new JobError("Job not found", 404);
  return job;
}

async function persist(job: ScanJob): Promise<ScanJob> {
  const updated: ScanJob = { ...job, updatedAt: new Date().toISOString() };
  await saveJob(updated);
  return updated;
}

/**
 * Renders the bundle for a job. Pure apart from reading its arguments, so the
 * same inputs always produce the same bytes — which is what lets a missing
 * file be rebuilt without inventing a new version.
 */
function buildBundle(
  job: ScanJob,
  selected: SelectedTool[] | undefined,
  includeLocalRelay: boolean,
  version: number,
  generatedAt: string
): { embedJs: string; manifestJson: string } {
  const tools = applySelection(job, selected);
  if (tools.length === 0) {
    throw new JobError("Select at least one tool", 400);
  }
  const manifest = buildManifest(
    job,
    tools,
    includeLocalRelay,
    version,
    generatedAt
  );
  return {
    embedJs: generateEmbedJs(manifest),
    manifestJson: JSON.stringify(manifest, null, 2),
  };
}

/**
 * Writes the bundle for a job at a given version. Deliberately free of any CDN
 * call: a plain download can land here when an artifact is missing from disk,
 * and a download must never publish anything.
 */
export async function generateJobBundle(
  id: string,
  selected: SelectedTool[] | undefined,
  includeLocalRelay: boolean,
  version: number
): Promise<{ job: ScanJob; embedJs: string; manifestJson: string }> {
  const job = await requireJob(id);
  if (job.status === "error") {
    throw new JobError(job.error || "Scan failed", 400);
  }
  if (job.status === "scanning" && job.candidates.length === 0) {
    throw new JobError("Scan is still running", 409);
  }

  const generatedAt = new Date().toISOString();
  const { embedJs, manifestJson } = buildBundle(
    job,
    selected,
    includeLocalRelay,
    version,
    generatedAt
  );

  await saveArtifact(id, EMBED_FILENAME, embedJs);
  await saveArtifact(id, MANIFEST_FILENAME, manifestJson);

  const updated: ScanJob = {
    ...job,
    selected,
    includeLocalRelay,
    version,
    status: "generated",
    generatedAt,
    updatedAt: generatedAt,
  };
  await saveJob(updated);
  return { job: updated, embedJs, manifestJson };
}

/**
 * Pushes an already-generated bundle to the CDN and records the outcome.
 * Publishing is best effort: the job stays generated and downloadable even
 * when the CDN is unreachable, so a site owner is never blocked by it.
 */
async function publishBundle(
  job: ScanJob,
  embedJs: string,
  manifestJson: string
): Promise<ScanJob> {
  if (!isCdnConfigured()) {
    return persist({ ...job, publishStatus: "skipped" });
  }

  const version = job.version ?? 1;
  // Record the id before the first byte leaves, not after. A publish that
  // fails partway can still have created a record at that key, and an id the
  // job forgot is a live embed nobody can ever unpublish.
  const owned = job.publicId
    ? job
    : await persist({ ...job, publicId: newPublicId() });
  const publicId = owned.publicId as string;
  const urls = hostedUrls(publicId);

  try {
    const outcome = await publishEmbed({
      publicId,
      version,
      embedJs,
      manifestJson,
      jobOrigin: owned.origin,
    });

    // Superseded means the CDN holds a bundle at least as new as ours. Prefer
    // whatever the newer run recorded; when nothing did, record the success
    // here so the job never reports failure for a bundle that is actually
    // live and reachable.
    const latest = outcome === "superseded" ? await requireJob(owned.id) : owned;
    if (outcome === "superseded" && latest.publishStatus === "published") {
      return latest;
    }

    return persist({
      ...latest,
      publicId,
      publishStatus: "published",
      // On a supersede we know the hosted version is at least ours, but not
      // exactly what it is, so keep any figure the newer run already recorded.
      publishedVersion:
        outcome === "superseded" ? (latest.publishedVersion ?? version) : version,
      publishedAt: new Date().toISOString(),
      publishError: undefined,
      hostedEmbedUrl: urls.embed,
      hostedManifestUrl: urls.manifest,
    });
  } catch (err) {
    return persist({
      ...owned,
      publicId,
      publishStatus: "failed",
      publishError: err instanceof Error ? err.message : String(err),
    });
  }
}

/** The generate route: new version, fresh bundle, then a best-effort publish. */
export async function generateAndPublish(
  id: string,
  selected?: SelectedTool[],
  includeLocalRelay = false
): Promise<ScanJob> {
  return runForJob(id, async () => {
    const existing = await requireJob(id);

    // Bump before generating, and keep the bump even if the CDN call fails.
    // Two different bundles must never claim the same version number.
    const version = (existing.version ?? 0) + 1;
    const { job, embedJs, manifestJson } = await generateJobBundle(
      id,
      selected,
      includeLocalRelay,
      version
    );
    return publishBundle(job, embedJs, manifestJson);
  });
}

/** Retries a failed publish without regenerating the bundle. */
export async function republishJob(id: string): Promise<ScanJob> {
  return runForJob(id, async () => {
    const job = await requireJob(id);
    if (!isCdnConfigured()) throw new JobError(CDN_NOT_CONFIGURED, 409);

    const embedJs = await readArtifact(id, EMBED_FILENAME);
    const manifestJson = await readArtifact(id, MANIFEST_FILENAME);
    if (!embedJs || !manifestJson) {
      throw new JobError("Generate the bundle first", 409);
    }

    return publishBundle(job, embedJs, manifestJson);
  });
}

/**
 * Removes the bundle from the CDN. The public id stays, so a later publish
 * reuses the same URL rather than stranding a snippet the owner already
 * pasted into their site.
 */
export async function unpublishJob(id: string): Promise<ScanJob> {
  return runForJob(id, async () => {
    const job = await requireJob(id);
    if (!job.publicId) {
      throw new JobError("Nothing has been published for this job", 409);
    }

    await unpublishEmbed(job.publicId);

    return persist({
      ...job,
      publishStatus: "unpublished",
      publishedVersion: undefined,
      publishError: undefined,
      // Dropping the URLs keeps the UI from offering a link that now 404s.
      hostedEmbedUrl: undefined,
      hostedManifestUrl: undefined,
    });
  });
}

/**
 * Rebuilds an artifact that went missing from disk. Reproduces the bundle the
 * job already describes: same tool selection, same version, same timestamp.
 * Regenerating anything else would put two different bundles behind one
 * version number, and the CDN serves that number as its cache validator.
 */
async function rebuildArtifacts(
  id: string
): Promise<{ embedJs: string; manifestJson: string } | null> {
  const job = await getJob(id);
  if (!job || job.candidates.length === 0) return null;

  const built = buildBundle(
    job,
    job.selected,
    job.includeLocalRelay,
    job.version ?? 1,
    job.generatedAt ?? job.updatedAt
  );
  await saveArtifact(id, EMBED_FILENAME, built.embedJs);
  await saveArtifact(id, MANIFEST_FILENAME, built.manifestJson);
  return built;
}

export async function getEmbedJs(id: string): Promise<string | null> {
  const existing = await readArtifact(id, EMBED_FILENAME);
  if (existing) return existing;
  return (await rebuildArtifacts(id))?.embedJs ?? null;
}

export async function getManifestJson(id: string): Promise<string | null> {
  const existing = await readArtifact(id, MANIFEST_FILENAME);
  if (existing) return existing;
  return (await rebuildArtifacts(id))?.manifestJson ?? null;
}
