import { afterAll, describe, expect, it } from "vitest";
import { POST as generatePost } from "@/app/api/jobs/[id]/generate/route";
import { GET as embedGet } from "@/app/api/jobs/[id]/embed.js/route";
import { GET as manifestGet } from "@/app/api/jobs/[id]/manifest.json/route";
import { GET as jobGet } from "@/app/api/jobs/[id]/route";
import { POST as scanPost } from "@/app/api/scan/route";
import { closeBrowser } from "@/lib/scanner";
import type { ScanJob } from "@/lib/types";
import { startFixtureServer } from "./helpers";

async function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("API happy path", () => {
  afterAll(async () => {
    await closeBrowser();
  });

  it("scan → select all → generate → fetch embed.js", async () => {
    const fixture = await startFixtureServer();
    try {
      const scanRes = await scanPost(
        new Request("http://127.0.0.1/api/scan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: `${fixture.url}/index.html` }),
        })
      );
      expect(scanRes.ok).toBe(true);
      const job = (await scanRes.json()) as ScanJob;
      expect(job.id).toMatch(/^job_/);
      expect(job.candidates.length).toBeGreaterThan(0);

      const got = await jobGet(new Request(`http://127.0.0.1/api/jobs/${job.id}`), await params(job.id));
      expect(got.ok).toBe(true);

      const selected = job.candidates.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        enabled: true,
      }));
      const genRes = await generatePost(
        new Request(`http://127.0.0.1/api/jobs/${job.id}/generate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tools: selected, includeLocalRelay: false }),
        }),
        await params(job.id)
      );
      expect(genRes.ok).toBe(true);
      const gen = (await genRes.json()) as { embedJs?: string };
      expect(gen.embedJs).toContain("embed.js");

      const embedRes = await embedGet(
        new Request(`http://127.0.0.1/api/jobs/${job.id}/embed.js`),
        await params(job.id)
      );
      expect(embedRes.ok).toBe(true);
      const js = await embedRes.text();
      expect(js.length).toBeGreaterThan(200);
      expect(js).toContain("registerTool");
      expect(js).toContain("get_page_info");

      const manifestRes = await manifestGet(
        new Request(`http://127.0.0.1/api/jobs/${job.id}/manifest.json`),
        await params(job.id)
      );
      expect(manifestRes.ok).toBe(true);
      const manifest = JSON.parse(await manifestRes.text()) as {
        tools: { name: string }[];
      };
      expect(manifest.tools.length).toBe(job.candidates.length);
    } finally {
      await fixture.close();
    }
  });
});
