import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { SCAN_TIMEOUT_MS } from "./config";
import type { ScanJob } from "./types";

/**
 * Names the file a save writes through before it is renamed into place. The
 * name must not end in `.json`: the backup collects this directory by that
 * extension, so a scratch file wearing it would be archived mid-write. Sits
 * beside the destination, and unique per save so concurrent writes to one job
 * cannot land on each other's scratch file.
 *
 * Exported because that extension is a contract with the backup script rather
 * than an implementation detail, and racing a write to observe it is unreliable.
 */
export function scratchPathFor(dest: string): string {
  return `${dest}.${randomUUID()}.part`;
}

/**
 * Writes through a temporary file and renames it into place. A plain write
 * leaves the destination truncated for as long as it takes to finish, so a
 * reader — or the backup that archives this directory — could pick up half a
 * job. rename swaps the name in one step: readers see either the previous
 * contents or the complete new ones.
 *
 * The temporary lives beside the destination because rename is only atomic
 * within a single filesystem.
 */
async function writeFileAtomic(dest: string, content: string): Promise<void> {
  const tmp = scratchPathFor(dest);
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, dest);
  } catch (err) {
    // A failed write must not leave its scratch file behind, but the original
    // error is what the caller needs to see.
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

function dataRoot() {
  return process.env.WEBMCP_DATA_DIR || path.join(process.cwd(), "data");
}

function jobsDir() {
  return path.join(dataRoot(), "jobs");
}

const ID_RE = /^[a-zA-Z0-9_-]{8,80}$/;

export function isJobId(id: string): boolean {
  return ID_RE.test(id);
}

export async function saveJob(job: ScanJob): Promise<void> {
  const dir = jobsDir();
  await mkdir(dir, { recursive: true });
  await writeFileAtomic(
    path.join(dir, `${job.id}.json`),
    JSON.stringify(job, null, 2)
  );
}

/**
 * How long a job may claim to be scanning before nobody believes it.
 *
 * A job is written as `scanning` before the work starts, and only the process
 * doing that work ever moves it on. If that process is killed — by the memory
 * limit, or by a deploy landing mid-scan — the file is left saying `scanning`
 * for good, and every later request answers "scan is still running" about a
 * scan that died weeks ago.
 */
const SCANNING_GOES_STALE_MS = SCAN_TIMEOUT_MS * 4;

export async function getJob(id: string): Promise<ScanJob | null> {
  if (!isJobId(id)) return null;
  try {
    const raw = await readFile(path.join(jobsDir(), `${id}.json`), "utf8");
    const job = JSON.parse(raw) as ScanJob;
    if (job.status !== "scanning") return job;

    const age = Date.now() - Date.parse(job.updatedAt);
    if (!Number.isFinite(age) || age <= SCANNING_GOES_STALE_MS) return job;
    // Corrected on the way out rather than rewritten. The file is still the
    // record of what happened; this is how every reader should interpret it,
    // and a read that writes would race with a scan that is merely slow.
    return {
      ...job,
      status: "error",
      error: "The scan was interrupted before it finished. Start a new one.",
    };
  } catch {
    return null;
  }
}

/** Removes a job record. Used when a job should never have been written. */
export async function deleteJob(id: string): Promise<void> {
  if (!isJobId(id)) return;
  await unlink(path.join(jobsDir(), `${id}.json`)).catch(() => {});
}

export async function saveArtifact(
  id: string,
  filename: string,
  content: string
): Promise<string> {
  if (!isJobId(id)) throw new Error("Invalid job id");
  const dir = path.join(jobsDir(), id);
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, filename);
  await writeFileAtomic(dest, content);
  return dest;
}

/**
 * Removes a job's generated files.
 *
 * Used when the tools they were built from have changed: the bytes on disk
 * still describe the old set, and serving them as this job's bundle would be a
 * lie about what it now contains.
 */
export async function removeArtifacts(
  id: string,
  filenames: string[]
): Promise<void> {
  if (!isJobId(id)) return;
  for (const filename of filenames) {
    await unlink(path.join(jobsDir(), id, filename)).catch(() => {});
  }
}

export async function readArtifact(
  id: string,
  filename: string
): Promise<string | null> {
  if (!isJobId(id)) return null;
  try {
    return await readFile(path.join(jobsDir(), id, filename), "utf8");
  } catch {
    return null;
  }
}
