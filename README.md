# WebMCP Forge

No-code **scan → catalog → embed** for [WebMCP](https://webmachinelearning.github.io/webmcp/). Website owners paste a public URL, pick the tools they want, and drop one script on the page. Agents then call structured tools **in the visitor’s open tab** (cookies, auth, live DOM) instead of screenshot-scraping.

That is the product pitch: **SEO for agents**. A 200-token `list_products` result beats a 20k-token screenshot.

Forge is for any HTML site. It is not a React-only SDK (MCP-B / Alibaba webmcp-nexus) and not a Cloudflare Worker MCP bridge. Those are useful; this tool is the no-code path.

## How a site owner uses it

1. Run the app (below) and paste your public homepage URL. Or click **Try the demo shop**.
2. Wait for the scan (home + up to 7 same-origin linked pages). Public pages only; we do not log in. `robots.txt` is respected lightly (if `Disallow: /`, extra pages are skipped).
3. On the job page, check the tools to enable. Optionally edit names/descriptions (`[a-z0-9_]` names).
4. Generate the bundle and download:
   - `webmcp-forge.manifest.json` — tool definitions, selectors, metadata
   - `webmcp-forge.embed.js` — self-contained script
5. Host `webmcp-forge.embed.js` on your origin (CSP-friendly file, not a huge inline blob) and add:

```html
<script src="/webmcp-forge.embed.js"></script>
```

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

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/scan` | `{ "url": "https://…" }` → job with candidate tools |
| `GET` | `/api/jobs/:id` | Job JSON |
| `POST` | `/api/jobs/:id/generate` | `{ tools, includeLocalRelay }` → writes embed + manifest |
| `GET` | `/api/jobs/:id/embed.js` | Generated script |
| `GET` | `/api/jobs/:id/manifest.json` | Generated manifest |

See [DEMO.md](./DEMO.md) for curl examples.

## Tests

`npm test` (Vitest) scans the **local** fixture shop with Playwright, injects the generated embed, asserts `getTools()` / `executeTool()`, and walks the API happy path. No live internet required.
