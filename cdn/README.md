# webmcp-forge-cdn

Cloudflare Worker that serves generated WebMCP embeds so site owners can paste
one script tag instead of hosting a file. Forge pushes bundles here; visitors
read them.

This folder has no `package.json`. Wrangler is a devDependency of the repo root
and every command runs from there with `-c cdn/wrangler.jsonc`.

## Routes

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| `GET` | `/e/:publicId/embed.js` | none | 200 JS, `ETag: "<version>"`, `Cache-Control: public, max-age=300`; 304 on matching `If-None-Match`; 404 if unpublished |
| `GET` | `/e/:publicId/manifest.json` | none | Same, as JSON |
| `PUT` | `/e/:publicId` | Bearer | Upsert `{ embedJs, manifestJson, version, jobOrigin? }`. 409 if `version` is lower than the stored one, 413 over 2 MB, 400 on a bad body |
| `DELETE` | `/e/:publicId` | Bearer | Unpublish. 204, and safe to repeat |
| `GET` | `/health` | none | 200 `ok` |

`HEAD` is accepted wherever `GET` is. Every error response is JSON `{ "error": ... }`, including the 503 returned when KV is unavailable, so a client can always parse the failure.

`publicId` is `pub_` + 32 hex characters, minted by Forge. It is **not** a job
id: the job id is the owner's admin key and never appears in a public URL. A
malformed id returns 404, the same as a missing one.

## Setup

```bash
npx wrangler login
npx wrangler kv namespace create EMBEDS -c cdn/wrangler.jsonc
```

Paste the returned id into `kv_namespaces[0].id` in `cdn/wrangler.jsonc`, then
set the shared secret and deploy:

```bash
npx wrangler secret put PUBLISH_TOKEN -c cdn/wrangler.jsonc
npm run cdn:deploy
```

Deploy prints the beta hostname. Put it in the Forge environment together with
the same token value:

```
CDN_BASE_URL=https://webmcp-forge-cdn.<account>.workers.dev
CDN_PUBLISH_TOKEN=<same value as PUBLISH_TOKEN>
```

Generate the token with something like `openssl rand -hex 32`. Never commit it;
`.dev.vars` and `.wrangler/` are gitignored.

## Local development

```bash
npm run cdn:dev
```

Serves on `http://localhost:8787` with a local KV namespace, so the placeholder
id in the config is fine. For local writes, put `PUBLISH_TOKEN=<value>` in
`cdn/.dev.vars`.

## Tests

```bash
npm test
```

`tests/cdn-worker.test.ts` boots this Worker on workerd through wrangler's
`createTestHarness` and covers auth, cache headers, the version guard, the size
cap, and unpublish. It runs from the repo's own vitest, so there is no separate
test command for this folder.

## Operational notes

- **Propagation is not instant.** KV takes up to 60 seconds to reach every
  location, browsers hold the file for 5 minutes, and `stale-while-revalidate`
  allows a further minute of stale serving, so a republish or an unpublish
  reaches visitors within roughly 7 minutes.
- **The version guard has a 60-second hole.** KV caches reads per location for
  60 seconds by default, and the guard reads through that same cache. A retry
  of an older publish arriving within a minute of a newer one can therefore
  read the stale version, pass the check, and silently revert the bundle.
  Forge must abandon a pending retry once a newer generate starts; the 409 is
  a backstop, not the ordering guarantee.
- **Free-tier ceilings:** 100,000 Worker requests per day, 100,000 KV reads per
  day, 1,000 KV writes per day, and one write per second to the same key.

## Open question before production

`observability.enabled` is on in `wrangler.jsonc`. Cloudflare's Workers Logs
docs say each invocation records "the Request, Response, and related metadata"
but do not say whether the `Authorization` header is redacted. If it is not,
`PUBLISH_TOKEN` sits in Cloudflare's logs for the retention window. Confirm
this with Cloudflare, or turn observability off, before deploying to
production. Rotating the token is `wrangler secret put PUBLISH_TOKEN` followed
by updating `CDN_PUBLISH_TOKEN` in the Forge environment.
