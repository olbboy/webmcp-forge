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
import { cn } from "@/lib/utils";
import type { ScanJob, SelectedTool, ToolCandidate } from "@/lib/types";

type Props = { job: ScanJob };

export function JobCatalog({ job }: Props) {
  const [tools, setTools] = useState<ToolCandidate[]>(() =>
    job.candidates.map((c) => ({ ...c }))
  );
  const [includeLocalRelay, setIncludeLocalRelay] = useState(
    job.includeLocalRelay
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState(job.status === "generated");
  const [copied, setCopied] = useState<string | null>(null);

  const enabledCount = tools.filter((t) => t.enabled).length;
  const origin =
    typeof window !== "undefined" ? window.location.origin : "";
  const embedUrl = `${origin}/api/jobs/${job.id}/embed.js`;
  const manifestUrl = `${origin}/api/jobs/${job.id}/manifest.json`;
  const snippet = `<script src="${embedUrl}"></script>`;
  const relaySnippet = `<script src="https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@latest/dist/browser/embed.js"></script>`;

  const pagesOk = job.pages.filter((p) => !p.error).length;

  function updateTool(id: string, patch: Partial<ToolCandidate>) {
    setTools((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function selectAll(enabled: boolean) {
    setTools((prev) => prev.map((t) => ({ ...t, enabled })));
  }

  async function generate() {
    setBusy(true);
    setError(null);
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
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Generate failed");
      setGenerated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function copy(label: string, text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
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
        <Card>
          <CardHeader>
            <CardTitle>Embed on your site</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>
              Download the files (CSP-friendly — serve them as static JS/JSON, do
              not paste a huge inline script unless your CSP allows it). Place this
              before <code>&lt;/body&gt;</code>:
            </p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
              {snippet}
            </pre>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                onClick={() => copy("tag", snippet)}
              >
                {copied === "tag" ? "Copied" : "Copy script tag"}
              </button>
              <a
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                href={embedUrl}
                download="webmcp-forge.embed.js"
              >
                Download embed.js
              </a>
              <a
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                href={manifestUrl}
                download="webmcp-forge.manifest.json"
              >
                Download manifest.json
              </a>
            </div>
            <p className="text-muted-foreground">
              Self-hosting: copy <code>webmcp-forge.embed.js</code> next to your
              site assets and point the script src at your own origin. The script
              waits for DOM, registers only the selected tools on{" "}
              <code>document.modelContext ?? navigator.modelContext</code>, and
              logs <code>[WebMCP Forge] registered: …</code>.
            </p>
            <p className="text-muted-foreground">
              Optional Cursor / Claude Desktop snippet (if you did not bake relay
              into the bundle):
            </p>
            <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
              {relaySnippet}
            </pre>
            <p className="text-xs text-muted-foreground">
              Hosted URLs for this anonymous job:{" "}
              <a className="underline" href={embedUrl}>
                embed.js
              </a>
              {" · "}
              <a className="underline" href={manifestUrl}>
                manifest.json
              </a>
            </p>
          </CardContent>
        </Card>
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
