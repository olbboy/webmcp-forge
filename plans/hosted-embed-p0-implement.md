# Hosted Embed P0 — Implement Plan

**Repo:** https://github.com/olbboy/webmcp-forge  
**Status:** Decisions locked 2026-09-10 · ready to implement  
**Related:** `plans/reports/brainstorm-260910-0119-hosted-embed.md` (if present)

## Locked decisions

| # | Decision |
|---|----------|
| 1 | CDN on `*.workers.dev` + **beta** label until CF zone/custom domain |
| 2 | **Auto-publish** after generate (best-effort); retry button; hide panel if env unset |
| 3 | Worker lives in monorepo folder **`cdn/`** |
| 4 | **Unpublish** in P0 |
| 5 | **`publicId` ≠ `jobId`** — CDN/snippet only expose `publicId` |

Also P0: replace fake self-origin snippet; monotonic integer `version`; customer snippet **no** `?v=`; UI discloses KV/cache lag; constant-time token compare; docs CSP + SRI→self-host.

---

## Current gaps (from source)

- `job-catalog.tsx` builds `embedUrl` from `window.location.origin` + `/api/jobs/${job.id}/embed.js` — looks "hosted" but is Forge origin / localhost.
- `newJobId()` → `job_*` 64-bit hex; used as sole key; **generate has no auth**.
- `buildManifest` hardcodes `version: "1.0.0"`.
- No CDN publish path, no Unpublish, no `publicId`.

---

## Target architecture

```
Visitor  --GET /e/:publicId/embed.js-->  CF Worker  --KV get-->  EMBED#{publicId}
Owner    --POST /api/jobs/:jobId/generate-->  Forge  --Bearer-->  Worker PUT/DELETE
Owner UI -- shows CDN snippet with publicId only; admin URL keeps jobId
```

### KV value shape

```ts
type CdnRecord = {
  publicId: string;
  version: number;          // monotonic int, starts at 1
  embedJs: string;
  manifestJson: string;
  updatedAt: string;        // ISO
  jobOrigin?: string;       // optional telemetry, not secrets
};
```

Keys: `embed:{publicId}` (and optional `manifest` same record).

### Public URLs (beta)

- `https://<worker>.workers.dev/e/<publicId>/embed.js`
- `https://<worker>.workers.dev/e/<publicId>/manifest.json`
- Test-only: `...?v=<version>` (not in customer snippet)

---

## Work packages (ordered)

### WP0 — Prep (0.5h)
- [ ] Read Next.js 16 notes in `AGENTS.md` / bundled docs before App Router edits
- [ ] Add env template: `.env.example` with `CDN_BASE_URL`, `CDN_PUBLISH_TOKEN` (Forge)  
- [ ] Document Worker secrets: `PUBLISH_TOKEN` via `wrangler secret put`

### WP1 — `cdn/` Worker package
**New tree**
```
cdn/
  package.json
  wrangler.toml          # kv_namespaces, workers_dev = true
  src/index.ts           # router
  src/auth.ts            # timingSafeEqual Bearer
  src/kv.ts
  tests/worker.test.ts   # miniflare or vitest-pool-workers
  README.md
```

**Routes**
| Method | Path | Auth | Behavior |
|--------|------|------|----------|
| GET | `/e/:publicId/embed.js` | no | 200 JS + ETag + Cache-Control; 404 if missing |
| GET | `/e/:publicId/manifest.json` | no | 200 JSON same headers |
| PUT | `/e/:publicId` | Bearer | body `{ embedJs, manifestJson, version }` upsert; debounce note |
| DELETE | `/e/:publicId` | Bearer | delete; 204 |
| GET | `/health` | no | ok |

**Headers (GET)**  
`Cache-Control: public, max-age=300, stale-while-revalidate=60`  
`ETag: "<version>"`  
`Content-Type: application/javascript; charset=utf-8` (or JSON)

**KV:** `cacheTtl: 60` on reads.

### WP2 — Data model (Forge)
**`src/lib/types.ts` — extend `ScanJob`:**
```ts
publicId?: string;           // minted once at first successful publish prep
publishStatus?: "skipped" | "published" | "failed" | "unpublished";
publishedVersion?: number;
publishedAt?: string;
publishError?: string;
hostedEmbedUrl?: string;
hostedManifestUrl?: string;
```

**`src/lib/jobs.ts` / ids:**
- Keep `newJobId()` for admin
- Add `newPublicId()` → e.g. `pub_` + 32 hex (128-bit) — **never** equal jobId
- Mint `publicId` on first generate when CDN configured (persist forever for that job; do **not** rotate in P0 unless unpublish+republish policy says so — P0: **stable publicId**)

**`src/lib/generator.ts`:**
- Replace hardcode `1.0.0` with `String(job.publishedVersion ?? nextVersion)` in manifest  
- Version source of truth = integer on job, bumped each successful publish

**`src/lib/cdn.ts` (new):**
- `isCdnConfigured()`
- `publishEmbed({ publicId, embedJs, manifestJson, version })`
- `unpublishEmbed(publicId)`
- timing-safe compare unused on Forge side (token only sent); Worker validates
- single-flight / 1s debounce per publicId if rapid regenerate

### WP3 — API routes (Forge)
1. **`POST .../generate`**  
   - Generate artifacts as today  
   - If CDN configured: ensure `publicId`, bump version, PUT Worker, set publish fields  
   - If CDN fails: still `status: generated`, `publishStatus: failed`, return error detail  
   - If CDN not configured: `publishStatus: skipped`  
   - Response includes `publicId`, `hostedEmbedUrl`, `publishStatus`, `publishedVersion` (never treat publicId as secret in JSON to owner UI — owner needs it)

2. **`POST .../publish`** (new) — retry publish without regenerating tools  
3. **`POST .../unpublish`** (new) — DELETE CDN + `publishStatus: unpublished`  

**Note:** Admin APIs still keyed by **jobId** only (no auth beyond secret URL). publicId never accepted as admin key.

### WP4 — UI (`job-catalog.tsx`)
- Remove fake `origin + /api/jobs/${id}/embed.js` as primary "hosted" card
- After generate:
  - **Hosted panel** (if configured or published): snippet `<script src="${CDN}/e/${publicId}/embed.js"></script>` + beta badge + lag notice (~up to ~6 min stale) + Copy  
  - **Self-host panel:** download links to Forge `/api/jobs/${jobId}/embed.js` (admin)  
  - Status badge: published / failed / skipped / unpublished  
  - Buttons: Publish lại, Unpublish  
  - Test link may use `?v=version`  
- Copy warns: "Link `/jobs/{jobId}` is admin — do not share"

### WP5 — Docs
- README + DEMO: Hosted vs self-host, CSP `script-src`, SRI not for hosted, beta workers.dev may change hostname, KV lag
- `cdn/README.md`: wrangler deploy, secrets, local `wrangler dev`

### WP6 — Tests (must pass before merge)
| Test | Assert |
|------|--------|
| Worker unit | GET 404; PUT+GET body; ETag; DELETE; 401 without token; 401 bad token |
| `cdn.ts` | skipped when env missing; publish called with version bump |
| API generate | with mock CDN: publicId set, publishStatus published |
| API generate | CDN throw → generated + failed + retry publish works |
| API unpublish | DELETE + status |
| E2E | generate → fetch hosted URL (wrangler/miniflare) → inject fixture → `getTools()` |
| Regression | existing 6 tests still green |

### WP7 — Root scripts
```json
"cdn:dev": "npm --prefix cdn run dev",
"cdn:deploy": "npm --prefix cdn run deploy",
"test:all": "npm test && npm --prefix cdn test"
```

---

## PR split (recommended)

| PR | Scope |
|----|--------|
| **PR1** | `cdn/` Worker + tests (standalone) |
| **PR2** | types/ids/cdn client + generate/publish/unpublish APIs |
| **PR3** | UI + docs + E2E glue |

Or one PR if small team — keep commits matching WP1→WP5.

---

## Acceptance criteria (P0 done)

1. `npm test` + `npm --prefix cdn test` exit 0  
2. With wrangler local + Forge env: full flow demo shop → generate → snippet uses **publicId** not jobId → GET CDN returns JS → tools register  
3. Unpublish → GET 404  
4. Without CDN env: generate works; hosted panel hidden; self-host download works  
5. Fake localhost hosted snippet gone  
6. UI shows beta + cache lag copy  

## Out of scope (P1+)
- Custom domain cutover  
- Version history list  
- Rotating publicId  
- R2 migration  
- Account auth / signed admin cookies  
- Regional Playwright scan  

## Open ops (Leo)
- Create CF account + `wrangler login`  
- Deploy worker → set `CDN_BASE_URL` + matching `CDN_PUBLISH_TOKEN` / `PUBLISH_TOKEN`  
