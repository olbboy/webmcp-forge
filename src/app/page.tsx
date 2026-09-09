import { ScanForm } from "@/components/scan-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-14">
      <div className="max-w-3xl space-y-5">
        <Badge variant="secondary">No-code scan → embed for any site</Badge>
        <h1 className="font-heading text-4xl font-semibold tracking-tight sm:text-5xl">
          SEO for agents. Structured tools beat screenshot scraping.
        </h1>
        <p className="text-lg leading-relaxed text-muted-foreground">
          Paste a public URL. WebMCP Forge proposes tools from the live page — forms,
          search, nav, product cards, buttons — then you download a self-contained{" "}
          <code>webmcp-forge.embed.js</code>. Agents call those tools{" "}
          <strong className="text-foreground">in the visitor&apos;s open tab</strong>{" "}
          (cookies, session, DOM), not a detached backend MCP session. That is the
          difference between a 200-token tool result and a 20k-token screenshot dump.
        </p>
        <p className="text-sm text-muted-foreground">
          Công cụ chạy ngay trong tab đang mở — giữ cookie và phiên đăng nhập của
          người dùng.
        </p>
      </div>

      <Card className="mt-10">
        <CardHeader>
          <CardTitle>1. Scan a public page</CardTitle>
        </CardHeader>
        <CardContent>
          <ScanForm />
        </CardContent>
      </Card>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        <Step
          n="2"
          title="Pick tools"
          body="A catalog of candidates: get_page_info, search_on_page, fill_form_*, list_products, open_path. Edit names and descriptions before you ship."
        />
        <Step
          n="3"
          title="Embed once"
          body="Host webmcp-forge.embed.js (CSP-friendly file, not a giant inline blob). Add one script tag. Native Chrome, @mcp-b/webmcp-polyfill, or Cursor via local-relay."
        />
        <Step
          n="4"
          title="Agents use the site"
          body="registerTool on document.modelContext (navigator.modelContext fallback). Forms never auto-submit unless dryRun is false and confirmSubmit is true."
        />
      </section>

      <section className="mt-12 space-y-3 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-foreground text-base font-medium">How this is different</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-foreground">MCP-B</strong> polyfills the WebMCP
            API — Forge generates the tools for sites that are not React apps.
          </li>
          <li>
            <strong className="text-foreground">Alibaba webmcp-nexus</strong> is an
            SDK plus build plugins. Forge is no-code: scan any HTML page and embed.
          </li>
          <li>
            <strong className="text-foreground">Cloudflare WebMCP</strong> bridges
            Worker MCP tools into Chrome. Forge stays on the page itself so agents
            inherit the user&apos;s session.
          </li>
        </ul>
      </section>
    </main>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">Step {n}</div>
      <h3 className="mt-1 font-medium">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
