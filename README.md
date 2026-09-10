# WebMCP Forge

No-code **scan → catalog → embed** for [WebMCP](https://webmachinelearning.github.io/webmcp/). Website owners paste a public URL, pick the tools they want, and drop one script on the page. Agents then call structured tools **in the visitor’s open tab** (cookies, auth, live DOM) instead of screenshot-scraping.

That is the product pitch: **SEO for agents**. A 200-token `list_products` result beats a 20k-token screenshot.

Forge is for any HTML site. It is not a React-only SDK (MCP-B / Alibaba webmcp-nexus) and not a Cloudflare Worker MCP bridge. Those are useful; this tool is the no-code path.

## How a site owner uses it

1. Run the app (below) and paste your public homepage URL. Or click **Try the demo shop**.
2. Wait for the scan (home + up to 7 same-origin linked pages). Public pages only; we do not log in. `robots.txt` is respected lightly (if `Disallow: /`, extra pages are skipped).
3. On the job page, check the tools to enable. Optionally edit names/descriptions (`[a-z0-9_]` names).
4. Generate the bundle. You then get two ways to ship it, side by side.
5. **Hosted (beta).** If this install has a CDN configured, the bundle is already
   published and the panel gives you one tag to paste before `</body>`:

```html
<script src="https://webmcp-forge-cdn.<account>.workers.dev/e/pub_…/embed.js"></script>
```

6. **Self-host.** Download `webmcp-forge.embed.js` and
   `webmcp-forge.manifest.json`, serve them from your own origin, and point the
   tag at your copy:

```html
<script src="/webmcp-forge.embed.js"></script>
```

Both files are CSP-friendly static assets, not a huge inline blob.

The script waits for the DOM, then registers selected tools on `document.modelContext` with fallback to `navigator.modelContext`. If neither exists, it installs a small polyfill so the page is still WebMCP-capable. It logs `[WebMCP Forge] registered: …` for each tool.

Optional Cursor / Claude Desktop: check **local-relay** before generate, or add:

```html
<script src="https://cdn.jsdelivr.net/npm/@mcp-b/webmcp-local-relay@latest/dist/browser/embed.js"></script>
```

Native Chrome and `@mcp-b/webmcp-polyfill` both work. Forms never submit unless the agent passes `dryRun: false` **and** `confirmSubmit: true`.

## Run locally

Requires Node 20+ and Chrome (Playwright uses the system Chrome channel).

```bash
npm install
npm test
npm run dev
```

App: [http://127.0.0.1:43127](http://127.0.0.1:43127)

Demo shop (scannable fixture): [http://127.0.0.1:43127/fixture-shop/index.html](http://127.0.0.1:43127/fixture-shop/index.html)

```bash
npm run build
npm start
```

Jobs are anonymous JSON files under `data/jobs/` (no accounts, no paid database).

### Optional: a lighter browser

The scanner drives Chrome by default. It can drive
[Lightpanda](https://github.com/lightpanda-io/browser) instead, which uses
roughly a twentieth of the memory because it has no rendering engine. The
scanner never needed one: it only reads the DOM.

```bash
docker compose --profile lightpanda up -d
```

Then set these and recreate the app:

```
SCANNER_ENGINE=lightpanda
SCANNER_CDP_URL=http://127.0.0.1:9222
```

Lightpanda reports to its makers unless told otherwise, and the compose file
tells it otherwise. The image tag moves, so confirm that setting still takes
after any pull:

```bash
docker compose logs lightpanda | grep "telemetry status"
```

It must say `disabled=true`. The same log carries a line about advertising a
loopback address; the compose file already answers it, and a scan failing with
`ECONNREFUSED 127.0.0.1:9222` means that answer went missing. If it says `disabled=false`, the image has changed
how it reads that setting; stop and check before scanning anything that is not
yours. The upstream privacy policy says URLs and page content are never sent,
which is why this is a check rather than a blocker.

Measured on the demo shop and three real sites, both engines proposed the same
tools. Chrome stays the default because Lightpanda ships only nightly builds,
and one real single-page app produced a small difference in what each engine
saw. Details and numbers are in
`plans/reports/research-260910-2125-lightpanda-thay-chrome.md`.

### Optional: hosting for your users

Without the two settings below, everything still works and site owners use the
self-host download. With them, Forge publishes each generated bundle to a
Cloudflare Worker so owners only paste a tag. Copy `.env.example` to
`.env.local` and fill in:

```
CDN_BASE_URL=https://webmcp-forge-cdn.<account>.workers.dev
CDN_PUBLISH_TOKEN=<same value as the Worker's PUBLISH_TOKEN secret>
```

Deploying that Worker takes about five minutes; see [cdn/README.md](./cdn/README.md).
Run it locally with `npm run cdn:dev`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/scan` | `{ "url": "https://…" }` → job with candidate tools. Publicly reachable addresses only; anything resolving into a private range answers 400 and creates no job |
| `GET` | `/api/jobs/:id` | Job JSON |
| `POST` | `/api/jobs/:id/generate` | `{ tools, includeLocalRelay }` → writes embed + manifest, then publishes to the CDN when one is configured |
| `POST` | `/api/jobs/:id/publish` | Retry a failed publish without rebuilding the bundle |
| `POST` | `/api/jobs/:id/unpublish` | Remove the bundle from the CDN |
| `GET` | `/api/jobs/:id/embed.js` | Generated script |
| `GET` | `/api/jobs/:id/manifest.json` | Generated manifest |

Scanning is limited to addresses on the public internet. A URL that resolves
into a private range — loopback, RFC1918, or the link-local block every cloud
serves its metadata from — is refused before a browser is opened, and so is a
redirect that lands in one. The check runs twice: once on the address given, and
once on what the browser actually connected to. `robots.txt` follows the same
rule, since it is fetched separately.

The job id is an unauthenticated admin key. Anyone holding it can change or
remove your tools, which is why it never appears in a hosted URL.

See [DEMO.md](./DEMO.md) for curl examples.

## Documentation

[`docs/`](./docs/README.md) covers the maintainer's view: how the pieces fit,
what is running in production and how to change it, why it is built this way,
and what the tests do and do not cover.

## Tests

`npm test` (Vitest) scans the **local** fixture shop with Playwright, injects the
generated embed, asserts `getTools()` / `executeTool()`, and walks the API happy
path. It also runs the CDN Worker on workerd through wrangler's test harness and
loads a published bundle into the fixture **by URL**, the way a visitor's browser
would. No live internet required, and no separate test command for `cdn/`.

## Hosted embeds (beta)

Hosted files come from a Cloudflare Worker reading Workers KV. What a site owner
should know before pasting the tag:

- **The file is public.** Anyone with the link can download it. It contains your
  tool definitions and selectors, not your data.
- **Changes are not instant.** A republish or an unpublish reaches visitors
  within about seven minutes: up to 60 seconds for KV to propagate, five minutes
  of browser cache, and a further minute of `stale-while-revalidate`.
- **Content Security Policy.** Add the CDN host to `script-src`:

```
Content-Security-Policy: script-src 'self' https://webmcp-forge-cdn.<account>.workers.dev
```

  If you enabled the local-relay option, the embed pulls in a second script at
  runtime, so `script-src` needs `https://cdn.jsdelivr.net` as well. The embed
  makes no other network calls, so no `connect-src` entry is required.

- **Subresource integrity is impractical for hosted files.** The tag would
  work, since the CDN sends the CORS header `integrity` needs. But the hash
  pins one exact byte sequence and regenerating replaces the bundle at the same
  URL, breaking every page still carrying the old hash. If your policy requires
  SRI, self-host and hash your own copy.
- **The hostname can still change** while this is in beta, which would mean
  updating the tag and the CSP once.
- **Unpublish is a kill switch with a delay.** The record is deleted the moment
  you press it, but edge locations that already read it keep answering for up
  to a minute, and browsers keep their copy for the window above.
