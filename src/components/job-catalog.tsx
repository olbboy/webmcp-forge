"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { publishSummary } from "@/lib/jobs";
import { cn } from "@/lib/utils";
import type { ScanJob, SelectedTool, ToolCandidate } from "@/lib/types";

type Props = {
  job: ScanJob;
  /** Whether the server has a CDN to publish to. Read from env, so server-only. */
  cdnConfigured: boolean;
};

/**
 * Derived from the server helper rather than restated, so dropping a field
 * from the response becomes a compile error instead of a panel that quietly
 * stops showing the snippet. `import type` is erased at build time, so this
 * pulls no server code into the browser bundle.
 */
type PublishState = ReturnType<typeof publishSummary>;

const STATUS_LABEL: Record<NonNullable<ScanJob["publishStatus"]>, string> = {
  published: "published",
  failed: "publish failed",
  unpublished: "unpublished",
  skipped: "not hosted",
};

const STATUS_VARIANT: Record<
  NonNullable<ScanJob["publishStatus"]>,
  "secondary" | "destructive" | "outline"
> = {
  published: "secondary",
  failed: "destructive",
  unpublished: "outline",
  skipped: "outline",
};

export function JobCatalog({ job, cdnConfigured }: Props) {
  const [tools, setTools] = useState<ToolCandidate[]>(() =>
    job.candidates.map((c) => ({ ...c }))
  );
  const [includeLocalRelay, setIncludeLocalRelay] = useState(
    job.includeLocalRelay
  );
  const [pending, setPending] = useState<
    "generate" | "publish" | "unpublish" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Failures from the publish buttons, kept apart from `error` so each message
   * can render next to the control that caused it.
   */
  const [actionError, setActionError] = useState<string | null>(null);
  const busy = pending !== null;
  const [generated, setGenerated] = useState(job.status === "generated");
  const [copied, setCopied] = useState<string | null>(null);
  const [publish, setPublish] = useState<PublishState>(() => ({
    id: job.id,
    status: job.status,
    publishedAt: job.publishedAt,
    version: job.version,
    publicId: job.publicId,
    publishStatus: job.publishStatus,
    publishedVersion: job.publishedVersion,
    publishError: job.publishError,
    hostedEmbedUrl: job.hostedEmbedUrl,
    hostedManifestUrl: job.hostedManifestUrl,
  }));

  const enabledCount = tools.filter((t) => t.enabled).length;
  // Relative, so the same markup works on the server and in the browser.
  const adminEmbedUrl = `/api/jobs/${job.id}/embed.js`;
  const adminManifestUrl = `/api/jobs/${job.id}/manifest.json`;
  const relaySnippet = `<script src="https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@latest/dist/browser/embed.js"></script>`;

  const hostedSnippet = publish.hostedEmbedUrl
    ? `<script src="${publish.hostedEmbedUrl}"></script>`
    : "";
  // The version only belongs on the test link. In the snippet it would force
  // the owner to re-paste the tag after every regenerate.
  const testUrl = publish.hostedEmbedUrl
    ? `${publish.hostedEmbedUrl}?v=${publish.publishedVersion ?? publish.version ?? 1}`
    : "";
  // Keep showing the panel for a job that was published before the CDN was
  // switched off, so its owner can still find the Unpublish button.
  const showHosted = cdnConfigured || Boolean(publish.publicId);
  // The server only requires a configured CDN and a bundle on disk, so every
  // state except "already published" has a way forward. Leaving `skipped` out
  // would strand any job generated before the CDN was switched on.
  const canPublish = cdnConfigured && publish.publishStatus !== "published";
  const publishLabel =
    publish.publishStatus === "failed"
      ? "Try publishing again"
      : publish.publishStatus === "unpublished"
        ? "Publish again"
        : "Publish";

  const pagesOk = job.pages.filter((p) => !p.error).length;

  function updateTool(id: string, patch: Partial<ToolCandidate>) {
    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function selectAll(enabled: boolean) {
    setTools((prev) => prev.map((t) => ({ ...t, enabled })));
  }

  async function generate() {
    setPending("generate");
    setError(null);
    setActionError(null);
    try {
      const payload: SelectedTool[] = tools.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        enabled: t.enabled,
      }));
      const res = await fetch(`/api/jobs/${job.id}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tools: payload, includeLocalRelay }),
      });
      const data = (await res.json()) as PublishState & { error?: string };
      if (!res.ok) throw new Error(data.error || "Generate failed");
      setPublish(data);
      setGenerated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setPending(null);
    }
  }

  /** Retry a failed publish, or take the bundle off the CDN. */
  async function callPublishRoute(action: "publish" | "unpublish") {
    setPending(action);
    setActionError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/${action}`, {
        method: "POST",
      });
      const data = (await res.json()) as PublishState & { error?: string };
      if (!res.ok) throw new Error(data.error || `Could not ${action}`);
      // Replaced whole, never merged: the server clears fields by omitting
      // them, and merging would keep a stale error or version around.
      setPublish(data);
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : `Could not ${action}`
      );
    } finally {
      setPending(null);
    }
  }

  async function copy(label: string, text: string) {
    try {
      // Absent outside a secure context, so an http deployment lands here.
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      // The snippet is selectable text, so say so instead of failing silently.
      setCopied(`${label}:manual`);
    }
    setTimeout(() => setCopied(null), 2500);
  }

  const kinds = useMemo(() => {
    const set = new Set(tools.map((t) => t.kind));
    return [...set];
  }, [tools]);

  if (job.status === "error") {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
        Scan failed: {job.error || "Unknown error"}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{job.status}</Badge>
          <Badge variant="outline">
            {pagesOk} page{pagesOk === 1 ? "" : "s"}
          </Badge>
          {job.robotsDisallowAll ? (
            <Badge variant="outline">robots.txt limited extras</Badge>
          ) : null}
        </div>
        <h1 className="font-heading text-3xl font-semibold tracking-tight">
          Candidate WebMCP tools
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          Derived from{" "}
          <a className="underline" href={job.url} target="_blank" rel="noreferrer">
            {job.url}
          </a>
          . Enable the tools you want agents to see, optionally rename them, then
          generate the embed bundle. Tools execute in the open tab — they inherit
          the user&apos;s cookies and DOM, they are not a second login.
        </p>
        <p className="text-xs text-muted-foreground">
          Chọn công cụ, sửa tên/mô tả nếu cần, rồi tải bundle nhúng.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          onClick={() => selectAll(true)}
        >
          Select all
        </button>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          onClick={() => selectAll(false)}
        >
          Select none
        </button>
        <span className="text-sm text-muted-foreground">
          {enabledCount} of {tools.length} enabled · kinds: {kinds.join(", ")}
        </span>
      </div>

      {tools.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No tool candidates. The page may have been empty, blocked, or timed
            out. Try a public HTML page with forms, nav, or product cards.
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {tools.map((tool) => (
            <li key={tool.id}>
              <Card>
                <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                  <Checkbox
                    checked={tool.enabled}
                    onCheckedChange={(checked) =>
                      updateTool(tool.id, { enabled: checked === true })
                    }
                    aria-label={`Enable ${tool.name}`}
                  />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="font-mono text-sm">{tool.name}</CardTitle>
                      <Badge variant="outline">{tool.kind}</Badge>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`${tool.id}-name`}>Tool name</Label>
                        <Input
                          id={`${tool.id}-name`}
                          value={tool.name}
                          onChange={(e) =>
                            updateTool(tool.id, { name: e.target.value })
                          }
                          onValueChange={(value) =>
                            updateTool(tool.id, { name: value })
                          }
                          className="font-mono"
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label htmlFor={`${tool.id}-desc`}>Description</Label>
                        <Textarea
                          id={`${tool.id}-desc`}
                          value={tool.description}
                          onChange={(e) =>
                            updateTool(tool.id, { description: e.target.value })
                          }
                          rows={2}
                        />
                      </div>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Separator />

      <label className="flex items-start gap-3 text-sm">
        <Checkbox
          checked={includeLocalRelay}
          onCheckedChange={(checked) => setIncludeLocalRelay(checked === true)}
        />
        <span>
          Also load <code>@mcp-b/webmcp-local-relay</code> embed.js so Cursor /
          Claude Desktop can reach these tab tools via the localhost relay.
          Requires the relay process on the agent machine.
        </span>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={cn(buttonVariants())}
          onClick={generate}
          disabled={busy || enabledCount === 0}
        >
          {busy ? "Generating…" : "Generate embed bundle"}
        </button>
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}

      {generated ? (
        <div className={cn("grid gap-4", showHosted && "lg:grid-cols-2")}>
          {showHosted ? (
            <Card>
              <CardHeader className="space-y-2">
                <div
                  className="flex flex-wrap items-center gap-2"
                  aria-live="polite"
                >
                  <CardTitle>Hosted</CardTitle>
                  <Badge variant="secondary">beta</Badge>
                  {publish.publishStatus ? (
                    <Badge variant={STATUS_VARIANT[publish.publishStatus]}>
                      {STATUS_LABEL[publish.publishStatus]}
                    </Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {publish.hostedEmbedUrl ? (
                  <>
                    <p>
                      We serve this file for you. Paste the tag before{" "}
                      <code>&lt;/body&gt;</code>:
                    </p>
                    <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
                      {hostedSnippet}
                    </pre>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" })
                        )}
                        onClick={() => copy("hosted", hostedSnippet)}
                      >
                        {copied === "hosted"
                          ? "Copied"
                          : copied === "hosted:manual"
                            ? "Select it above"
                            : "Copy script tag"}
                      </button>
                      <a
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" })
                        )}
                        href={testUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Test the file
                      </a>
                      <button
                        type="button"
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" })
                        )}
                        onClick={() => callPublishRoute("unpublish")}
                        disabled={busy}
                      >
                        {pending === "unpublish" ? "Unpublishing…" : "Unpublish"}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    {publish.publishStatus === "unpublished"
                      ? "Removed from the CDN. Publishing again reuses the same URL, so a tag already on your site keeps working."
                      : publish.publishStatus === "failed"
                        ? "The bundle was built but could not reach the CDN. The self-host download is unaffected."
                        : "Nothing is hosted for this job yet."}
                  </p>
                )}

                {publish.publishStatus === "failed" &&
                publish.hostedEmbedUrl ? (
                  <p className="text-muted-foreground">
                    The tag above still works. Visitors keep getting the last
                    version that reached the CDN until this succeeds.
                  </p>
                ) : null}

                {publish.publishError ? (
                  <p className="text-sm text-destructive">
                    {publish.publishError}
                  </p>
                ) : null}

                {canPublish ? (
                  <button
                    type="button"
                    className={cn(buttonVariants({ size: "sm" }))}
                    onClick={() => callPublishRoute("publish")}
                    disabled={busy}
                  >
                    {pending === "publish" ? "Publishing…" : publishLabel}
                  </button>
                ) : null}

                {/* Kept inside the panel: an error shown above the fold, next
                    to Generate, reads as unrelated to the button just used. */}
                {actionError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {actionError}
                  </p>
                ) : null}

                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li>
                    This file is public. Anyone with the link can download it.
                  </li>
                  <li>
                    A new version, or an unpublish, reaches visitors within
                    about seven minutes. Edge and browser caches hold the old
                    copy until then.
                  </li>
                  <li>
                    Beta: the hostname can still change before general
                    availability, and you would need to update the tag.
                  </li>
                  <li>
                    The link to <em>this page</em> is your admin link. Anyone
                    who has it can change or remove your tools. Do not share it.
                  </li>
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Self-host</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p>
                Download both files, serve them from your own origin, and point
                the tag at your copy. Use this when your policy forbids
                third-party scripts, or when you want a subresource integrity
                hash, which hosting cannot offer because the file changes when
                you regenerate.
              </p>
              <div className="flex flex-wrap gap-2">
                <a
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                  href={adminEmbedUrl}
                  download="webmcp-forge.embed.js"
                >
                  Download embed.js
                </a>
                <a
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                  href={adminManifestUrl}
                  download="webmcp-forge.manifest.json"
                >
                  Download manifest.json
                </a>
              </div>
              <p className="text-muted-foreground">
                The script waits for the DOM, registers only the tools you
                enabled on{" "}
                <code>document.modelContext ?? navigator.modelContext</code>,
                and logs <code>[WebMCP Forge] registered: …</code>.
              </p>
              <p className="text-muted-foreground">
                Optional Cursor / Claude Desktop snippet, if you did not bake
                the relay into the bundle:
              </p>
              <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
                {relaySnippet}
              </pre>
              <button
                type="button"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
                onClick={() => copy("relay", relaySnippet)}
              >
                {copied === "relay"
                  ? "Copied"
                  : copied === "relay:manual"
                    ? "Select it above"
                    : "Copy relay tag"}
              </button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <details className="rounded-xl border p-4 text-sm">
        <summary className="cursor-pointer font-medium">Scanned pages</summary>
        <ul className="mt-3 space-y-2 text-muted-foreground">
          {job.pages.map((page) => (
            <li key={page.url}>
              <span className="text-foreground">{page.title || "(untitled)"}</span>
              {" — "}
              {page.url}
              {page.error ? ` · error: ${page.error}` : ""}
              {` · ${page.forms.length} forms, ${page.products.length} products, ${page.searchInputs.length} search`}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
