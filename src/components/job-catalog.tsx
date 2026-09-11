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
import type {
  HealthReport,
  PageSnapshot,
  RescanProposal,
  ScanJob,
  SelectedTool,
  ToolCandidate,
  ToolChange,
} from "@/lib/types";

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
  /** What the last accepted scan saw, which a re-scan replaces. */
  const [pages, setPages] = useState<PageSnapshot[]>(job.pages);
  const [includeLocalRelay, setIncludeLocalRelay] = useState(
    job.includeLocalRelay
  );
  const [pending, setPending] = useState<
    | "generate"
    | "publish"
    | "unpublish"
    | "health"
    | "rescan"
    | "apply"
    | "discard"
    | null
  >(null);
  const [health, setHealth] = useState<HealthReport | undefined>(job.health);
  const [healthError, setHealthError] = useState<string | null>(null);
  /**
   * A re-scan that has been run and is waiting for an answer. Seeded from the
   * job so that closing the tab mid-decision does not throw the scan away.
   */
  const [proposal, setProposal] = useState<RescanProposal | undefined>(
    job.pendingRescan
  );
  const [rescanError, setRescanError] = useState<string | null>(null);
  /** Set once a proposal is accepted, to explain why the tools below moved. */
  const [rescanApplied, setRescanApplied] = useState(false);
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
  // `generated` matters as much as the status: applying a re-scan deletes the
  // bundle these buttons would upload.
  const canPublish =
    cdnConfigured && generated && publish.publishStatus !== "published";
  const publishLabel =
    publish.publishStatus === "failed"
      ? "Try publishing again"
      : publish.publishStatus === "unpublished"
        ? "Publish again"
        : "Publish";

  const pagesOk = pages.filter((p) => !p.error).length;

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

  /**
   * Re-opens the site and asks whether each tool can still find what it acts
   * on. Nothing is changed by it — a dead selector is reported, never repaired,
   * because repairing would alter tools the owner already approved.
   */
  async function runHealthCheck() {
    setPending("health");
    setHealthError(null);
    try {
      const res = await fetch(`/api/jobs/${job.id}/health`, { method: "POST" });
      const data = (await res.json()) as {
        health?: HealthReport;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Could not check the tools");
      setHealth(data.health);
    } catch (err) {
      setHealthError(
        err instanceof Error ? err.message : "Could not check the tools"
      );
    } finally {
      setPending(null);
    }
  }

  /**
   * Opens the site again and parks what it finds.
   *
   * Deliberately two steps. The tools on a live site were chosen, renamed and
   * switched off by their owner; a scan finding different markup is a reason to
   * ask them, not a reason to overwrite that.
   */
  async function runRescan() {
    setPending("rescan");
    setRescanError(null);
    setRescanApplied(false);
    try {
      const res = await fetch(`/api/jobs/${job.id}/rescan`, { method: "POST" });
      const data = (await res.json()) as {
        pendingRescan?: RescanProposal;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Could not scan the site");
      setProposal(data.pendingRescan);
    } catch (err) {
      setRescanError(
        err instanceof Error ? err.message : "Could not scan the site"
      );
    } finally {
      setPending(null);
    }
  }

  async function decideRescan(decision: "apply" | "discard") {
    setPending(decision);
    setRescanError(null);
    try {
      const res = await fetch(
        `/api/jobs/${job.id}/rescan${decision === "apply" ? "/apply" : ""}`,
        { method: decision === "apply" ? "POST" : "DELETE" }
      );
      const data = (await res.json()) as {
        candidates?: ToolCandidate[];
        pages?: PageSnapshot[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Could not finish");
      setProposal(undefined);
      if (decision === "apply" && data.candidates) {
        setTools(data.candidates.map((c) => ({ ...c })));
        if (data.pages) setPages(data.pages);
        setRescanApplied(true);
        // The bundle on disk was built from the old tools and has been deleted,
        // so the download links below would now 404. What is already on the
        // customer's site keeps serving until they generate again.
        setGenerated(false);
        // A check of the tools that no longer exist would only confuse.
        setHealth(undefined);
      }
    } catch (err) {
      setRescanError(err instanceof Error ? err.message : "Could not finish");
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
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }))}
          onClick={runHealthCheck}
          disabled={busy || tools.length === 0}
        >
          {pending === "health" ? "Checking…" : "Check tools against the site"}
        </button>
        <button
          type="button"
          className={cn(buttonVariants({ variant: "outline" }))}
          onClick={runRescan}
          disabled={busy || Boolean(proposal)}
        >
          {pending === "rescan" ? "Scanning…" : "Scan the site again"}
        </button>
      </div>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
      <RescanPanel
        proposal={proposal}
        error={rescanError}
        applied={rescanApplied}
        busy={busy}
        pending={pending}
        onApply={() => decideRescan("apply")}
        onDiscard={() => decideRescan("discard")}
      />
      <HealthPanel report={health} error={healthError} />

      {generated || publish.publicId ? (
        <div
          className={cn("grid gap-4", showHosted && generated && "lg:grid-cols-2")}
        >
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

                {!generated && publish.hostedEmbedUrl ? (
                  <p className="text-muted-foreground">
                    The tools have changed since this file was built. Visitors
                    keep getting the version above until you generate again.
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

          {generated ? (
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
                enabled on <code>document.modelContext</code> — adopting one
                the page already has — and logs{" "}
                <code>[WebMCP Forge] registered: …</code>.
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
          ) : null}
        </div>
      ) : null}

      <AgentReach />

      <details className="rounded-xl border p-4 text-sm">
        <summary className="cursor-pointer font-medium">Scanned pages</summary>
        <ul className="mt-3 space-y-2 text-muted-foreground">
          {pages.map((page) => (
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

const HEALTH_LABEL: Record<"ok" | "degraded" | "missing", string> = {
  ok: "working",
  degraded: "partly gone",
  missing: "not found",
};

const HEALTH_VARIANT: Record<
  "ok" | "degraded" | "missing",
  "secondary" | "outline" | "destructive"
> = {
  ok: "secondary",
  degraded: "outline",
  missing: "destructive",
};

/**
 * Shows the last health check.
 *
 * Sorted worst first, because the reason to open this is to find what broke,
 * and a list of twelve working tools with one dead one buried in the middle
 * answers the wrong question.
 */
function HealthPanel({
  report,
  error,
}: {
  report?: HealthReport;
  error: string | null;
}) {
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!report) return null;

  const rank = { missing: 0, degraded: 1, ok: 2 } as const;
  const rows = [...report.tools].sort((a, b) => rank[a.status] - rank[b.status]);
  const broken = rows.filter((t) => t.status !== "ok").length;

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">
          {broken === 0
            ? "Every tool can still find what it acts on"
            : `${broken} tool${broken === 1 ? "" : "s"} need attention`}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Checked {new Date(report.checkedAt).toLocaleString()} across{" "}
          {report.pagesChecked} page{report.pagesChecked === 1 ? "" : "s"}
          {report.pagesFailed > 0
            ? ` — ${report.pagesFailed} would not open, so this is incomplete`
            : ""}
          .
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="space-y-2 text-sm">
          {rows.map((tool) => (
            <li key={tool.id} className="flex flex-wrap items-center gap-2">
              <Badge variant={HEALTH_VARIANT[tool.status]}>
                {HEALTH_LABEL[tool.status]}
              </Badge>
              <code>{tool.name}</code>
              {tool.detail ? (
                <span className="text-muted-foreground">{tool.detail}</span>
              ) : null}
            </li>
          ))}
        </ul>
        {broken > 0 ? (
          <p className="text-sm text-muted-foreground">
            A tool that cannot find its target answers an agent with an error
            rather than doing nothing visible. Re-scan the site to pick up its
            current markup, then generate again.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

const CHANGE_LABEL: Record<ToolChange["change"], string> = {
  removed: "gone",
  updated: "changed",
  added: "new",
  unchanged: "same",
};

const CHANGE_VARIANT: Record<
  ToolChange["change"],
  "secondary" | "outline" | "destructive"
> = {
  removed: "destructive",
  updated: "outline",
  added: "secondary",
  unchanged: "outline",
};

/**
 * Shows a re-scan that has not been accepted yet.
 *
 * The panel exists because of what a re-scan is allowed to cost. The script tag
 * is already on somebody's site, so the job keeps its id either way — but the
 * tools in it were chosen by their owner, and swapping them because the markup
 * moved would undo that silently. So this shows what would change, and waits.
 */
function RescanPanel({
  proposal,
  error,
  applied,
  busy,
  pending,
  onApply,
  onDiscard,
}: {
  proposal?: RescanProposal;
  error: string | null;
  applied: boolean;
  busy: boolean;
  pending: string | null;
  onApply: () => void;
  onDiscard: () => void;
}) {
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  if (!proposal) {
    if (!applied) return null;
    return (
      <p className="text-sm text-muted-foreground" role="status">
        The list below is what the site has now. Anything found for the first
        time arrived switched off. Nothing has reached your site yet — generate
        again when you are ready.
      </p>
    );
  }

  const moved = proposal.changes.filter((c) => c.change !== "unchanged");
  const same = proposal.changes.length - moved.length;

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">
          {moved.length === 0
            ? "The site has not changed"
            : `${moved.length} difference${moved.length === 1 ? "" : "s"} since the last scan`}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Scanned {new Date(proposal.scannedAt).toLocaleString()}. Nothing has
          been changed yet.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {moved.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {moved.map((change) => (
              <li key={change.id} className="flex flex-wrap items-center gap-2">
                <Badge variant={CHANGE_VARIANT[change.change]}>
                  {CHANGE_LABEL[change.change]}
                </Badge>
                <code>{change.name}</code>
                <span className="text-muted-foreground">{change.kind}</span>
                {change.detail ? (
                  <span className="text-muted-foreground">
                    — {change.detail}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {same > 0 ? (
          <p className="text-sm text-muted-foreground">
            {same} tool{same === 1 ? "" : "s"} unchanged.
          </p>
        ) : null}

        {moved.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              Accepting keeps every name you chose and every switch you set. A
              tool found for the first time arrives switched off.
            </li>
            <li>
              Your site is untouched either way. The file it loads only changes
              when you generate again.
            </li>
            <li>
              Any renames you have typed below but not yet generated will be
              replaced by this list.
            </li>
          </ul>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {/* Nothing differs, so accepting would only delete a bundle that is
              still correct and make its owner generate again for no reason.
              With nothing to decide, there is one button. */}
          {moved.length > 0 ? (
            <button
              type="button"
              className={cn(buttonVariants({ size: "sm" }))}
              onClick={onApply}
              disabled={busy}
            >
              {pending === "apply" ? "Applying…" : "Use the new scan"}
            </button>
          ) : null}
          <button
            type="button"
            className={cn(
              buttonVariants({
                variant: moved.length > 0 ? "outline" : "default",
                size: "sm",
              })
            )}
            onClick={onDiscard}
            disabled={busy}
          >
            {pending === "discard"
              ? "Closing…"
              : moved.length > 0
                ? "Keep what I have"
                : "Close"}
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * When this table was last checked against the outside world.
 *
 * Shown to the owner rather than kept in a comment: the answer moves, and a
 * confident table with no date on it is how a page ends up quietly lying.
 */
const AGENT_REACH_CHECKED = "10 September 2026";

type AgentRow = {
  agent: string;
  reach: "yes" | "flag" | "no";
  detail: string;
};

const AGENT_REACH: AgentRow[] = [
  {
    agent: "ChatGPT desktop app",
    reach: "yes",
    detail: "On by default, on a recent model. Not available on Enterprise or Edu plans",
  },
  {
    agent: "ChatGPT Work (cloud browser)",
    reach: "yes",
    detail: "Observed working; OpenAI has not documented it",
  },
  {
    agent: "Brave Leo",
    reach: "flag",
    detail: "Nightly only, behind a flag",
  },
  {
    agent: "Chrome + Gemini",
    reach: "no",
    detail: "Chrome ships the API in an origin trial, but Gemini does not read the tools",
  },
  {
    agent: "Claude for Chrome",
    reach: "no",
    detail: "It can invoke a tool but has no way to discover one. Claude Code, Cowork and Desktop share this extension",
  },
  {
    agent: "Perplexity Comet, Sider, Monica, HARPA",
    reach: "no",
    detail: "No standard way for an extension to read them yet",
  },
];

const REACH_LABEL: Record<AgentRow["reach"], string> = {
  yes: "yes",
  flag: "behind a flag",
  no: "not yet",
};

/**
 * What pasting the tag actually buys today.
 *
 * The honest answer is narrower than the pitch — it is mostly ChatGPT — and an
 * owner deciding whether to put a script on their site deserves to read that
 * before they do, not afterwards. The headline sits in the summary so it is
 * legible without opening anything.
 */
function AgentReach() {
  return (
    <details className="rounded-xl border p-4 text-sm">
      <summary className="cursor-pointer font-medium">
        Which agents can call these tools today — mostly ChatGPT, for now
      </summary>
      <div className="mt-3 space-y-3">
        <ul className="space-y-2">
          {AGENT_REACH.map((row) => (
            <li key={row.agent} className="flex flex-wrap items-baseline gap-2">
              <Badge variant={row.reach === "yes" ? "secondary" : "outline"}>
                {REACH_LABEL[row.reach]}
              </Badge>
              <span className="font-medium">{row.agent}</span>
              <span className="text-muted-foreground">{row.detail}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          So installing WebMCP today mostly means serving people using ChatGPT.
          That is an early bet with a reason behind it — ChatGPT is the largest
          agent with this switched on by default — but do not expect broad
          traffic yet. The tools cost nothing while nobody calls them, and the
          tag does not have to be re-pasted when the rest catch up.
        </p>
        <p className="text-xs text-muted-foreground">
          Checked {AGENT_REACH_CHECKED}. This moves quickly and we do not
          re-check it automatically, so treat anything marked{" "}
          <em>not yet</em> as worth testing yourself before relying on it.
        </p>
      </div>
    </details>
  );
}
