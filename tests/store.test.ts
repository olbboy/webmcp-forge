import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getJob,
  readArtifact,
  saveArtifact,
  saveJob,
  scratchPathFor,
} from "@/lib/store";
import type { ScanJob } from "@/lib/types";

/**
 * Jobs used to be written straight over the destination, which left the file
 * truncated for as long as the write took. A reader arriving in that window —
 * or the backup that tars this directory — picked up half a job. These hold
 * the replacement: a save is never visible until it is complete.
 *
 * The payloads are large on purpose. A short write lands in one go and looks
 * atomic whether or not it is, so a small fixture would pass against the very
 * bug these exist to catch.
 */

const jobsDir = () => path.join(process.env.WEBMCP_DATA_DIR as string, "jobs");

function job(id: string, filler: string): ScanJob {
  return {
    id,
    url: "https://shop.example/",
    origin: "https://shop.example",
    status: "ready",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [],
    candidates: [],
    includeLocalRelay: false,
    // Carried in a real field so the payload survives JSON.stringify.
    error: filler,
  };
}

describe("the file a save writes through", () => {
  const dest = "/data/jobs/job_abcdef12.json";

  it("is not collected by the backup, which globs .json", () => {
    // Observing this during a real save is a race; the name is the contract.
    expect(scratchPathFor(dest).endsWith(".json")).toBe(false);
  });

  it("sits beside the file it replaces, so the rename stays atomic", () => {
    expect(path.dirname(scratchPathFor(dest))).toBe(path.dirname(dest));
  });

  it("differs every time, so concurrent saves cannot collide", () => {
    const names = new Set(
      Array.from({ length: 200 }, () => scratchPathFor(dest))
    );
    expect(names.size).toBe(200);
  });
});

describe("saving a job", () => {
  it("never lets a reader see a half-written job", async () => {
    const id = "job_atomic_reader";
    const big = "x".repeat(3_000_000);
    await saveJob(job(id, `${big}-first`));

    // Reads run against a moving target: each save rewrites the whole file.
    const saves = Array.from({ length: 12 }, (_, i) =>
      saveJob(job(id, `${big}-${i}`))
    );
    const reads = Array.from({ length: 60 }, () => getJob(id));
    const [, seen] = await Promise.all([
      Promise.all(saves),
      Promise.all(reads),
    ]);

    // getJob answers null when the JSON will not parse, so a torn read shows
    // up here as a null rather than as a thrown error.
    expect(seen.filter((j) => j === null)).toEqual([]);
    for (const j of seen) {
      expect(j?.id).toBe(id);
      expect(j?.error?.endsWith("first") || /-\d+$/.test(j?.error ?? "")).toBe(
        true
      );
    }
  });

  it("leaves the last save on disk, whole", async () => {
    const id = "job_atomic_last";
    await saveJob(job(id, "one"));
    await saveJob(job(id, "two"));

    const raw = await readFile(path.join(jobsDir(), `${id}.json`), "utf8");
    expect(JSON.parse(raw).error).toBe("two");
  });

  it("keeps no scratch files once the save returns", async () => {
    const id = "job_atomic_tidy";
    await saveJob(job(id, "y".repeat(500_000)));

    const left = (await readdir(jobsDir())).filter((f) => f.endsWith(".part"));
    expect(left).toEqual([]);
  });

  it("does not offer a scratch file to anything collecting .json", async () => {
    // The backup archives this directory by extension, so every .json here
    // has to be complete at every instant — including the scratch file a save
    // writes through, which is why its name must not end in .json.
    const big = "z".repeat(6_000_000);
    let saving = true;
    const saves = Promise.all(
      Array.from({ length: 4 }, (_, i) => saveJob(job(`job_atomic_ext${i}`, big)))
    ).finally(() => {
      saving = false;
    });

    // One snapshot can easily land after the writes finish and prove nothing,
    // so sample until the saves settle.
    let samples = 0;
    while (saving) {
      const names = (await readdir(jobsDir())).filter((f) =>
        f.endsWith(".json")
      );
      for (const f of names) {
        const raw = await readFile(path.join(jobsDir(), f), "utf8");
        expect(() => JSON.parse(raw) as unknown).not.toThrow();
      }
      samples += 1;
    }

    await saves;
    expect(samples).toBeGreaterThan(0);
  });
});

describe("saving an artifact", () => {
  it("never lets a reader see a half-written bundle", async () => {
    const id = "job_atomic_artifact";
    const big = "console.log('x');".repeat(120_000);
    await saveArtifact(id, "embed.js", `${big}//first`);

    const saves = Array.from({ length: 8 }, (_, i) =>
      saveArtifact(id, "embed.js", `${big}//${i}`)
    );
    const reads = Array.from({ length: 40 }, () => readArtifact(id, "embed.js"));
    const [, seen] = await Promise.all([
      Promise.all(saves),
      Promise.all(reads),
    ]);

    // Every read must be a complete bundle: the full body plus one marker.
    for (const content of seen) {
      expect(content).not.toBeNull();
      expect(content?.length).toBeGreaterThanOrEqual(big.length);
      expect(content?.startsWith(big)).toBe(true);
    }
  });
});
