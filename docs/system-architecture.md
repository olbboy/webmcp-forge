# System architecture

WebMCP Forge scans a public website, proposes tools an agent can call, and
gives the site owner a script tag that registers those tools in the visitor's
own tab. This describes how the running system is put together. For how to use
it, see the [README](../README.md).

## Three pieces, three runtimes

| Piece | Where it runs | Why there |
| --- | --- | --- |
| Forge app (Next.js) | Container on a droplet | Needs a real browser process and a writable disk |
| CDN (`cdn/`) | Cloudflare Worker + Workers KV | Serving a small static file near the visitor is all it does |
| Browser | Chrome, or Lightpanda over CDP | Chrome by default; the choice is a deployment setting |

The app cannot run on Workers or Pages. Both are V8 isolates with no
subprocess and no filesystem, and the scanner launches a browser
(`src/lib/scanner.ts`) while jobs are JSON files on disk (`src/lib/store.ts`).

## The flow

```
owner → /api/scan     → browser visits up to 8 same-origin pages
                      → extract.ts reads the DOM
                      → heuristics.ts proposes tools
owner → /api/generate → generator.ts writes embed.js + manifest.json
                      → cdn.ts PUTs them to the Worker
visitor's browser     → GET cdn.<domain>/e/<publicId>/embed.js
                      → tools register on document.modelContext
```

## Invariants worth not breaking

**A public id is not a job id.** The job id is an unauthenticated admin key:
anyone holding it can change or delete the tools. A hosted URL appears in the
page source of every site that embeds it. They must never be the same string.
`src/lib/jobs.ts` mints `pub_` + 32 hex separately and stores it before the
first byte reaches the CDN, because a publish that fails partway can still have
created a record, and an id the job forgot is an embed nobody can take down.

**One version, one bundle.** `job.version` increments on every generate,
including one whose publish failed. The Worker serves that number as the ETag,
so two different bundles claiming the same version would be served from cache
interchangeably. A missing artifact is rebuilt from the stored selection and
timestamp so it reproduces the published bytes exactly.

**A publish that fell behind is dropped, not queued.** The Worker rejects a
backwards version with 409, but it reads through a KV cache that can be a
minute stale, so that check cannot be the ordering guarantee. `src/lib/cdn.ts`
tracks the newest version requested per public id and refuses to send anything
older.

**Work on one job is serialised.** The store is a JSON file with no locking.
Two concurrent generates would each read the same version, mint their own
public id, and leave one bundle live that the job no longer remembers.
`src/lib/key-queue.ts` serialises per job id, and per public id for the CDN,
where KV accepts one write per second to a key.

**The browser is warm, not immortal.** Launching Chrome costs a second or two,
so it is reused between scans. Left alone it would hold several hundred
megabytes on a machine that runs other work, so scans in flight are counted and
an idle spell closes it (`BROWSER_IDLE_MS`, five minutes by default).

**One form is one tool.** The same form on eight product pages is one tool with
eight selectors, not eight tools. Identity is what a form does — method,
endpoint path, fields, intent — never where it sits in a document.

## Modules

| Module | Responsibility |
| --- | --- |
| `scanner.ts` | Browser lifetime, engine choice, crawling |
| `extract.ts` | Runs inside the page; reads the DOM only |
| `heuristics.ts` | Turns page snapshots into tool candidates |
| `generator.ts` | Renders `embed.js` and `manifest.json` |
| `cdn.ts` | Talks to the Worker; supersede and serialisation |
| `jobs.ts` | Job lifecycle: generate, publish, unpublish |
| `store.ts` | JSON files under the data directory |
| `key-queue.ts` | Per-key serialisation, used by two callers |
| `cdn/src/` | The Worker: routes, auth, KV |

## What the extractor is allowed to use

Only `querySelector`, `querySelectorAll`, `textContent`, `closest`, and the
document title and location. No computed styles, no bounding boxes, no
visibility checks.

This is why a browser without a rendering engine can drive it at all, and it is
worth preserving. Reaching for layout would rule Lightpanda out and make the
scan far more expensive.
