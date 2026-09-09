import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ScanJob } from "./types";

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
  await writeFile(
    path.join(dir, `${job.id}.json`),
    JSON.stringify(job, null, 2),
    "utf8"
  );
}

export async function getJob(id: string): Promise<ScanJob | null> {
  if (!isJobId(id)) return null;
  try {
    const raw = await readFile(path.join(jobsDir(), `${id}.json`), "utf8");
    return JSON.parse(raw) as ScanJob;
  } catch {
    return null;
  }
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
  await writeFile(dest, content, "utf8");
  return dest;
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
