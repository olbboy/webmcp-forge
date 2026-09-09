import { applySelection, buildManifest, generateEmbedJs } from "./generator";
import { parseScanUrl, scanSite } from "./scanner";
import { getJob, readArtifact, saveArtifact, saveJob } from "./store";
import type { ScanJob, SelectedTool } from "./types";

export function newJobId(): string {
  return `job_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export async function runScan(rawUrl: string): Promise<ScanJob> {
  parseScanUrl(rawUrl);
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

export async function generateJobBundle(
  id: string,
  selected?: SelectedTool[],
  includeLocalRelay = false
): Promise<{ job: ScanJob; embedJs: string; manifestJson: string }> {
  const job = await getJob(id);
  if (!job) throw new Error("Job not found");
  if (job.status === "error") throw new Error(job.error || "Scan failed");
  if (job.status === "scanning" && job.candidates.length === 0) {
    throw new Error("Scan is still running");
  }

  const tools = applySelection(job, selected);
  if (tools.length === 0) throw new Error("Select at least one tool");

  const manifest = buildManifest(job, tools, includeLocalRelay);
  const embedJs = generateEmbedJs(manifest);
  const manifestJson = JSON.stringify(manifest, null, 2);

  await saveArtifact(id, "webmcp-forge.embed.js", embedJs);
  await saveArtifact(id, "webmcp-forge.manifest.json", manifestJson);

  const updated: ScanJob = {
    ...job,
    selected,
    includeLocalRelay,
    status: "generated",
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await saveJob(updated);
  return { job: updated, embedJs, manifestJson };
}

export async function getEmbedJs(id: string): Promise<string | null> {
  const existing = await readArtifact(id, "webmcp-forge.embed.js");
  if (existing) return existing;
  const job = await getJob(id);
  if (!job || job.candidates.length === 0) return null;
  const { embedJs } = await generateJobBundle(id, undefined, job.includeLocalRelay);
  return embedJs;
}

export async function getManifestJson(id: string): Promise<string | null> {
  const existing = await readArtifact(id, "webmcp-forge.manifest.json");
  if (existing) return existing;
  const job = await getJob(id);
  if (!job || job.candidates.length === 0) return null;
  const { manifestJson } = await generateJobBundle(
    id,
    undefined,
    job.includeLocalRelay
  );
  return manifestJson;
}
