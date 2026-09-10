# WebMCP Forge demo

## Screenshots (manual)

1. Start `npm run dev` and open http://127.0.0.1:43127
2. Homepage: URL field, **Try the demo shop**, copy about in-tab tools vs screenshot scraping.
3. Click **Try the demo shop** then **Scan site**. Capture the spinner.
4. Job catalog: checkboxes, editable names, **Generate embed bundle**.
5. Embed card: script tag, download buttons, local-relay snippet.
6. Open http://127.0.0.1:43127/fixture-shop/index.html DevTools console after adding the generated script. You should see `[WebMCP Forge] registered: get_page_info` and the rest.
7. With a CDN configured, the job page shows a **Hosted** panel next to
   **Self-host**. Capture both, then Unpublish and capture the changed badge.

## Curl happy path

Use the built-in fixture so you do not need an external website.

```bash
# 1. Scan
JOB=$(curl -sS -X POST http://127.0.0.1:43127/api/scan \
  -H 'content-type: application/json' \
  -d '{"url":"http://127.0.0.1:43127/fixture-shop/index.html"}')
echo "$JOB" | head -c 400
ID=$(node -e "const j=JSON.parse(process.env.JOB); process.stdout.write(j.id)" JOB="$JOB")

# 2. Read job
curl -sS "http://127.0.0.1:43127/api/jobs/$ID" | head -c 400

# 3. Select all candidates and generate
node <<'NODE'
const job = JSON.parse(process.env.JOB);
const body = {
  includeLocalRelay: false,
  tools: job.candidates.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    enabled: true,
  })),
};
require('fs').writeFileSync('/tmp/webmcp-gen.json', JSON.stringify(body));
NODE
curl -sS -X POST "http://127.0.0.1:43127/api/jobs/$ID/generate" \
  -H 'content-type: application/json' \
  -d @/tmp/webmcp-gen.json

# 4. Fetch embed (must be non-empty JS)
curl -sS "http://127.0.0.1:43127/api/jobs/$ID/embed.js" | head -c 200
curl -sS "http://127.0.0.1:43127/api/jobs/$ID/manifest.json" | head -c 200
```

Pass `JOB` into the node snippet by exporting it first if your shell does not keep the variable in `process.env.JOB`. Simpler one-liner using jq:

```bash
ID=$(curl -sS -X POST http://127.0.0.1:43127/api/scan \
  -H 'content-type: application/json' \
  -d '{"url":"http://127.0.0.1:43127/fixture-shop/index.html"}' | jq -r .id)

TOOLS=$(curl -sS "http://127.0.0.1:43127/api/jobs/$ID" | jq '{includeLocalRelay:false, tools:[.candidates[]|{id,name,description,enabled:true}]}')

curl -sS -X POST "http://127.0.0.1:43127/api/jobs/$ID/generate" \
  -H 'content-type: application/json' \
  -d "$TOOLS"

curl -sS "http://127.0.0.1:43127/api/jobs/$ID/embed.js" | wc -c
```

## What the fixture contains

`public/fixture-shop/` is a static shop: primary nav, search box, product cards, newsletter, contact form, catalog filters, shipping estimator. The scanner should propose `get_page_info`, `get_site_nav`, `list_products`, `search_on_page`, `fill_form_*`, `click_by_text`, and `open_path`.

## Hosted publishing

Needs `CDN_BASE_URL` and `CDN_PUBLISH_TOKEN` in `.env.local`, and the Worker
running (`npm run cdn:dev` in another shell). Without them `generate` still
succeeds and reports `"publishStatus": "skipped"`.

```bash
ID=$(curl -sS -X POST http://127.0.0.1:43127/api/scan \
  -H 'content-type: application/json' \
  -d '{"url":"http://127.0.0.1:43127/fixture-shop/index.html"}' | jq -r .id)

# Generate now also publishes. The response carries the public URL.
curl -sS -X POST "http://127.0.0.1:43127/api/jobs/$ID/generate" \
  -H 'content-type: application/json' -d '{"includeLocalRelay":false}' \
  | jq '{publishStatus, version, publicId, hostedEmbedUrl}'

# The public id is not the job id: the job id is the admin key.
HOSTED=$(curl -sS "http://127.0.0.1:43127/api/jobs/$ID" | jq -r .hostedEmbedUrl)
curl -sS -D - -o /dev/null "$HOSTED"      # 200, ETag "1", Cache-Control max-age=300

# Retry a publish that failed, without rebuilding the bundle.
curl -sS -X POST "http://127.0.0.1:43127/api/jobs/$ID/publish" | jq '{publishStatus, publishedVersion}'

# Take it down. Caches keep serving the old copy for a few more minutes.
curl -sS -X POST "http://127.0.0.1:43127/api/jobs/$ID/unpublish" | jq '{publishStatus, hostedEmbedUrl}'
curl -sS -o /dev/null -w '%{http_code}\n' "$HOSTED"   # 404
```
