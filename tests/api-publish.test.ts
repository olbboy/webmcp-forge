import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as embedGet } from "@/app/api/jobs/[id]/embed.js/route";
import { GET as manifestGet } from "@/app/api/jobs/[id]/manifest.json/route";
import { POST as generatePost } from "@/app/api/jobs/[id]/generate/route";
import { POST as publishPost } from "@/app/api/jobs/[id]/publish/route";
import { POST as unpublishPost } from "@/app/api/jobs/[id]/unpublish/route";
import { getJob, saveJob } from "@/lib/store";
import type { ScanJob, SelectedTool } from "@/lib/types";

/**
 * Drives the publish routes against a job written straight to the store, so
 * these cases never launch a browser. The scan path is covered by api.test.ts.
 */

const BASE_URL = "https://cdn.test";
const PUBLIC_ID_PATTERN = /^pub_[a-f0-9]{32}$/;

async function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

let jobCounter = 0;

async function seedJob(): Promise<string> {
  jobCounter += 1;
  const id = `job_publish_${jobCounter.toString().padStart(4, "0")}`;
  const now = new Date().toISOString();
  const job: ScanJob = {
    id,
    url: "https://shop.example/index.html",
    origin: "https://shop.example",
    status: "ready",
    createdAt: now,
    updatedAt: now,
    pages: [],
    candidates: [
      {
        id: "cand_page_info",
        name: "get_page_info",
        description: "Read the page title, description and headings.",
        kind: "get_page_info",
        enabled: true,
        inputSchema: { type: "object", properties: {} },
      },
      {
        id: "cand_links",
        name: "list_links",
        description: "List the links on the page.",
        kind: "list_links",
        enabled: true,
        inputSchema: { type: "object", properties: {} },
      },
    ],
    includeLocalRelay: false,
  };
  await saveJob(job);
  return id;
}

function configureCdn() {
  vi.stubEnv("CDN_BASE_URL", BASE_URL);
  vi.stubEnv("CDN_PUBLISH_TOKEN", "test-publish-token");
}

function disableCdn() {
  vi.stubEnv("CDN_BASE_URL", "");
  vi.stubEnv("CDN_PUBLISH_TOKEN", "");
}

/** Typed so `mock.calls` keeps the request shape a test wants to inspect. */
type FetchMock = (url: string, init: RequestInit) => Promise<Response>;

function mockFetch(handler: () => Promise<Response> | Response) {
  const fetchMock = vi.fn<FetchMock>(async () => handler());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function okResponse() {
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

function generate(id: string, tools?: SelectedTool[]) {
  return generatePost(
    new Request(`http://127.0.0.1/api/jobs/${id}/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ includeLocalRelay: false, tools }),
    }),
    { params: Promise.resolve({ id }) }
  );
}

/** Enables only the first candidate, so a rebuild has something to get wrong. */
function onlyPageInfo(): SelectedTool[] {
  return [
    {
      id: "cand_page_info",
      name: "get_page_info",
      description: "Read the page title, description and headings.",
      enabled: true,
    },
    {
      id: "cand_links",
      name: "list_links",
      description: "List the links on the page.",
      enabled: false,
    },
  ];
}

type PublishPayload = {
  status?: string;
  version?: number;
  publicId?: string;
  publishStatus?: string;
  publishedVersion?: number;
  publishError?: string;
  hostedEmbedUrl?: string;
  hostedManifestUrl?: string;
  error?: string;
};

describe("publish routes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("marks the job skipped and mints no public id when the CDN is off", async () => {
    disableCdn();
    const fetchMock = mockFetch(okResponse);
    const id = await seedJob();

    const res = await generate(id);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as PublishPayload;

    expect(body.status).toBe("generated");
    expect(body.publishStatus).toBe("skipped");
    expect(body.version).toBe(1);
    expect(body.publicId).toBeUndefined();
    expect(body.hostedEmbedUrl).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("publishes on generate and exposes a URL that hides the job id", async () => {
    configureCdn();
    mockFetch(okResponse);
    const id = await seedJob();

    const body = (await (await generate(id)).json()) as PublishPayload;

    expect(body.publishStatus).toBe("published");
    expect(body.version).toBe(1);
    expect(body.publishedVersion).toBe(1);
    expect(body.publicId).toMatch(PUBLIC_ID_PATTERN);
    expect(body.hostedEmbedUrl).toBe(`${BASE_URL}/e/${body.publicId}/embed.js`);
    expect(body.hostedManifestUrl).toBe(
      `${BASE_URL}/e/${body.publicId}/manifest.json`
    );
    // The whole point of a separate public id: the admin key stays private.
    expect(body.hostedEmbedUrl).not.toContain(id);
  });

  it("bumps the version but keeps the public id on a second generate", async () => {
    configureCdn();
    mockFetch(okResponse);
    const id = await seedJob();

    const first = (await (await generate(id)).json()) as PublishPayload;
    const second = (await (await generate(id)).json()) as PublishPayload;

    expect(first.version).toBe(1);
    expect(second.version).toBe(2);
    expect(second.publishedVersion).toBe(2);
    // A stable id means the snippet the owner pasted keeps working.
    expect(second.publicId).toBe(first.publicId);
  });

  it("writes the published version into the bundle itself", async () => {
    configureCdn();
    const fetchMock = mockFetch(okResponse);
    const id = await seedJob();

    await generate(id);
    await generate(id);

    const lastBody = JSON.parse(
      String(fetchMock.mock.calls.at(-1)?.[1]?.body)
    ) as { version: number; embedJs: string; manifestJson: string };
    expect(lastBody.version).toBe(2);
    expect(JSON.parse(lastBody.manifestJson).version).toBe("2");
    expect(lastBody.embedJs).toContain('"version":"2"');
  });

  it("still generates when the CDN call fails, and records why", async () => {
    configureCdn();
    mockFetch(() => {
      throw new Error("network down");
    });
    const id = await seedJob();

    const body = (await (await generate(id)).json()) as PublishPayload;

    // The owner keeps a working self-host download either way.
    expect(body.status).toBe("generated");
    expect(body.publishStatus).toBe("failed");
    expect(body.version).toBe(1);
    expect(body.publishedVersion).toBeUndefined();
    expect(body.publishError).toContain("network down");
    // The id is kept so a retry lands on the same URL.
    expect(body.publicId).toMatch(PUBLIC_ID_PATTERN);
  });

  it("retries a failed publish without changing the version", async () => {
    configureCdn();
    let failNext = true;
    mockFetch(() => {
      if (failNext) {
        failNext = false;
        throw new Error("network down");
      }
      return okResponse();
    });
    const id = await seedJob();

    const failed = (await (await generate(id)).json()) as PublishPayload;
    expect(failed.publishStatus).toBe("failed");

    const retried = (await (
      await publishPost(
        new Request(`http://127.0.0.1/api/jobs/${id}/publish`, {
          method: "POST",
        }),
        await params(id)
      )
    ).json()) as PublishPayload;

    expect(retried.publishStatus).toBe("published");
    expect(retried.version).toBe(1);
    expect(retried.publishedVersion).toBe(1);
    expect(retried.publicId).toBe(failed.publicId);
  });

  it("refuses to publish a job that has never been generated", async () => {
    configureCdn();
    mockFetch(okResponse);
    const id = await seedJob();

    const res = await publishPost(
      new Request(`http://127.0.0.1/api/jobs/${id}/publish`, { method: "POST" }),
      await params(id)
    );
    expect(res.status).toBe(409);
  });

  it("unpublishes and drops the hosted URLs", async () => {
    configureCdn();
    const fetchMock = mockFetch(okResponse);
    const id = await seedJob();
    await generate(id);

    const body = (await (
      await unpublishPost(
        new Request(`http://127.0.0.1/api/jobs/${id}/unpublish`, {
          method: "POST",
        }),
        await params(id)
      )
    ).json()) as PublishPayload;

    expect(body.publishStatus).toBe("unpublished");
    expect(body.hostedEmbedUrl).toBeUndefined();
    expect(body.publishedVersion).toBeUndefined();
    // The id survives so a later publish reuses the same snippet URL.
    expect(body.publicId).toMatch(PUBLIC_ID_PATTERN);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });

  it("refuses to unpublish a job that was never published", async () => {
    configureCdn();
    mockFetch(okResponse);
    const id = await seedJob();

    const res = await unpublishPost(
      new Request(`http://127.0.0.1/api/jobs/${id}/unpublish`, {
        method: "POST",
      }),
      await params(id)
    );
    expect(res.status).toBe(409);
  });

  it("keeps the job published when the CDN reports a newer bundle", async () => {
    configureCdn();
    mockFetch(
      () => new Response(JSON.stringify({ error: "Stale version" }), { status: 409 })
    );
    const id = await seedJob();

    const body = (await (await generate(id)).json()) as PublishPayload;

    // A 409 means the hosted bundle is at least as new as ours, so reporting
    // failure would be wrong and would strand the owner on a retry loop.
    expect(body.publishStatus).toBe("published");
    expect(body.publishError).toBeUndefined();
    expect(body.publicId).toMatch(PUBLIC_ID_PATTERN);
    expect(body.hostedEmbedUrl).toContain(String(body.publicId));

    // The id must be on disk, or nothing can ever unpublish that record.
    const stored = await getJob(id);
    expect(stored?.publicId).toBe(body.publicId);
  });

  it("keeps one public id when two generates run at the same time", async () => {
    configureCdn();
    const fetchMock = mockFetch(okResponse);
    const id = await seedJob();

    const [first, second] = (await Promise.all([
      generate(id).then((r) => r.json()),
      generate(id).then((r) => r.json()),
    ])) as PublishPayload[];

    // Two ids would mean two live bundles, one of which the job has forgotten
    // and can therefore never take down.
    expect(first.publicId).toBe(second.publicId);
    expect([first.version, second.version].sort()).toEqual([1, 2]);

    const publishedIds = new Set(
      fetchMock.mock.calls.map((call) => String(call[0]))
    );
    expect(publishedIds.size).toBe(1);
  });

  it("rebuilds a missing bundle from the stored selection, byte for byte", async () => {
    configureCdn();
    const fetchMock = mockFetch(okResponse);
    const id = await seedJob();
    await generate(id, onlyPageInfo());

    const published = JSON.parse(
      String(fetchMock.mock.calls.at(-1)?.[1]?.body)
    ) as { manifestJson: string };
    expect(JSON.parse(published.manifestJson).tools).toHaveLength(1);

    const dataDir = process.env.WEBMCP_DATA_DIR as string;
    await rm(path.join(dataDir, "jobs", id, "webmcp-forge.manifest.json"));

    const res = await manifestGet(
      new Request(`http://127.0.0.1/api/jobs/${id}/manifest.json`),
      await params(id)
    );
    const rebuilt = await res.text();

    // Same tools and same bytes: a different bundle under the same version
    // would be served from cache under the version's own ETag.
    expect(JSON.parse(rebuilt).tools).toHaveLength(1);
    expect(rebuilt).toBe(published.manifestJson);
  });

  it("rebuilds a missing bundle on download without publishing or bumping", async () => {
    configureCdn();
    const fetchMock = mockFetch(okResponse);
    const id = await seedJob();
    await generate(id);
    const publishCalls = fetchMock.mock.calls.length;

    // Simulate the artifact going missing from disk.
    const dataDir = process.env.WEBMCP_DATA_DIR as string;
    await rm(path.join(dataDir, "jobs", id, "webmcp-forge.embed.js"));

    const res = await embedGet(
      new Request(`http://127.0.0.1/api/jobs/${id}/embed.js`),
      await params(id)
    );
    expect(res.ok).toBe(true);
    expect(await res.text()).toContain('"version":"1"');

    // A plain download must never touch the CDN or advance the version.
    expect(fetchMock.mock.calls.length).toBe(publishCalls);
    const job = await getJob(id);
    expect(job?.version).toBe(1);
    expect(job?.publishStatus).toBe("published");
  });
});
