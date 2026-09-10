import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CDN_NOT_CONFIGURED,
  hostedUrls,
  isCdnConfigured,
  publishEmbed,
  unpublishEmbed,
} from "@/lib/cdn";

const BASE_URL = "https://cdn.test";
const TOKEN = "test-publish-token";

/** Distinct ids keep the module's in-flight bookkeeping from leaking between tests. */
let idCounter = 0;
function nextPublicId(): string {
  idCounter += 1;
  return `pub_${idCounter.toString(16).padStart(32, "0")}`;
}

function configure(base = BASE_URL, token: string | undefined = TOKEN) {
  vi.stubEnv("CDN_BASE_URL", base);
  vi.stubEnv("CDN_PUBLISH_TOKEN", token ?? "");
}

/** Typed so `mock.calls` keeps the request shape a test wants to inspect. */
type FetchMock = (url: string, init: RequestInit) => Promise<Response>;

function mockFetch(...responses: Response[]) {
  const fetchMock = vi.fn<FetchMock>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("fetch called more times than the test expected");
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function ok(body: unknown = { ok: true }) {
  return new Response(JSON.stringify(body), { status: 200 });
}

function bundle(version: number) {
  return {
    version,
    embedJs: `console.log(${version});`,
    manifestJson: JSON.stringify({ version }),
  };
}

describe("cdn client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is not configured when either setting is missing", () => {
    vi.stubEnv("CDN_BASE_URL", "");
    vi.stubEnv("CDN_PUBLISH_TOKEN", TOKEN);
    expect(isCdnConfigured()).toBe(false);

    vi.stubEnv("CDN_BASE_URL", BASE_URL);
    vi.stubEnv("CDN_PUBLISH_TOKEN", "");
    expect(isCdnConfigured()).toBe(false);
  });

  it("is configured when both settings are present", () => {
    configure();
    expect(isCdnConfigured()).toBe(true);
  });

  it("refuses to publish when the CDN is not configured", async () => {
    vi.stubEnv("CDN_BASE_URL", "");
    vi.stubEnv("CDN_PUBLISH_TOKEN", "");
    await expect(
      publishEmbed({ publicId: nextPublicId(), ...bundle(1) })
    ).rejects.toThrow(CDN_NOT_CONFIGURED);
  });

  it("builds hosted URLs from the public id and trims a trailing slash", () => {
    configure("https://cdn.test/");
    const urls = hostedUrls("pub_abc");
    expect(urls.embed).toBe("https://cdn.test/e/pub_abc/embed.js");
    expect(urls.manifest).toBe("https://cdn.test/e/pub_abc/manifest.json");
  });

  it("sends an authenticated PUT carrying the version", async () => {
    configure();
    const fetchMock = mockFetch(ok());
    const publicId = nextPublicId();

    const outcome = await publishEmbed({
      publicId,
      ...bundle(4),
      jobOrigin: "https://shop.example",
    });

    expect(outcome).toBe("published");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/e/${publicId}`);
    expect(init.method).toBe("PUT");
    // Assert the header exists without putting its value in the output.
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization?.startsWith("Bearer ")).toBe(true);
    expect(JSON.parse(String(init.body))).toMatchObject({
      version: 4,
      jobOrigin: "https://shop.example",
    });
  });

  it("reports the status when the CDN rejects a publish", async () => {
    configure();
    mockFetch(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));

    await expect(
      publishEmbed({ publicId: nextPublicId(), ...bundle(1) })
    ).rejects.toThrow(/401/);
  });

  it("treats a 409 as superseded, not a failure", async () => {
    configure();
    mockFetch(new Response(JSON.stringify({ error: "Stale version" }), { status: 409 }));

    const outcome = await publishEmbed({
      publicId: nextPublicId(),
      ...bundle(1),
    });
    expect(outcome).toBe("superseded");
  });

  it("sends each publish when they are awaited in turn", async () => {
    configure();
    const fetchMock = mockFetch(ok(), ok());
    const publicId = nextPublicId();

    expect(await publishEmbed({ publicId, ...bundle(1) })).toBe("published");
    expect(await publishEmbed({ publicId, ...bundle(2) })).toBe("published");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops a publish once a newer version has been requested", async () => {
    configure();
    const fetchMock = mockFetch(ok());
    const publicId = nextPublicId();

    // The newer generate is requested while the older retry is still queued.
    // Sending the older one would revert the bundle, because the Worker's own
    // guard reads through a KV cache that can be up to a minute stale.
    const newer = publishEmbed({ publicId, ...bundle(2) });
    const older = publishEmbed({ publicId, ...bundle(1) });

    expect(await older).toBe("superseded");
    expect(await newer).toBe("published");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      version: 2,
    });
  });

  it("drops a publish that fell behind while waiting in the queue", async () => {
    configure();
    const sent: number[] = [];
    let releaseFirst!: () => void;
    let announceFirst!: () => void;
    const firstIsSending = new Promise<void>((resolve) => {
      announceFirst = resolve;
    });
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let isFirst = true;
    const fetchMock = vi.fn<FetchMock>(async (_url, init) => {
      sent.push(JSON.parse(String(init.body)).version as number);
      if (isFirst) {
        isFirst = false;
        // Hold the first PUT open so the next two have to queue behind it.
        announceFirst();
        await firstMayFinish;
      }
      return ok();
    });
    vi.stubGlobal("fetch", fetchMock);
    const publicId = nextPublicId();

    const inFlight = publishEmbed({ publicId, ...bundle(5) });
    // Wait until the first request is genuinely on the wire. Requested any
    // sooner, the later versions would be dropped before it ever sent.
    await firstIsSending;

    // Both queue behind the first. By the time the middle one gets its turn,
    // the last one has already been requested, so sending it would be work
    // done only to be overwritten a moment later.
    const overtaken = publishEmbed({ publicId, ...bundle(6) });
    const newest = publishEmbed({ publicId, ...bundle(7) });
    releaseFirst();

    expect(await inFlight).toBe("published");
    expect(await overtaken).toBe("superseded");
    expect(await newest).toBe("published");
    expect(sent).toEqual([5, 7]);
  });

  it("lets a later publish succeed after an earlier one failed", async () => {
    configure();
    const fetchMock = mockFetch(new Response("boom", { status: 500 }), ok());
    const publicId = nextPublicId();

    await expect(publishEmbed({ publicId, ...bundle(1) })).rejects.toThrow(/500/);
    expect(await publishEmbed({ publicId, ...bundle(2) })).toBe("published");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("unpublishes with an authenticated DELETE", async () => {
    configure();
    const fetchMock = mockFetch(new Response(null, { status: 204 }));
    const publicId = nextPublicId();

    await unpublishEmbed(publicId);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/e/${publicId}`);
    expect(init.method).toBe("DELETE");
  });

  it("treats an already-absent bundle as unpublished", async () => {
    configure();
    mockFetch(new Response(JSON.stringify({ error: "Not found" }), { status: 404 }));
    await expect(unpublishEmbed(nextPublicId())).resolves.toBeUndefined();
  });

  it("reports the status when an unpublish fails", async () => {
    configure();
    mockFetch(new Response("nope", { status: 500 }));
    await expect(unpublishEmbed(nextPublicId())).rejects.toThrow(/500/);
  });
});
