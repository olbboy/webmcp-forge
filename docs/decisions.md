# Decisions

Choices that shaped the system, with what settled each one. The measurements
behind them are in `plans/reports/`; this is the conclusion, not the workings.

## The app does not run on Cloudflare

The scanner launches a real browser process and jobs are files on disk.
Workers and Pages Functions are V8 isolates with neither. Running the app there
would mean porting the scanner to Cloudflare's Browser Rendering and moving job
storage to KV, R2 or D1: a rewrite, not a deployment.

So the app is a container on a droplet and only the CDN is a Worker.

## One Worker serves every customer

Not one Worker per customer site. Adding a customer adds a KV key, not a
deployment.

Cloudflare allows 100 Workers per account on the free plan and 500 on paid, so
one-per-customer would hit a wall at the hundredth customer, and each new one
would wait out a deploy. A KV write is near-instant and has no per-customer
ceiling beyond storage.

## The public id is separate from the job id

The job id is an unauthenticated admin key. The hosted URL is visible in the
page source of every site that embeds the bundle. Reusing one as the other
would hand every visitor of a customer's site the ability to rewrite that
customer's tools.

Before this was separated, the job page offered a snippet pointing at Forge's
own origin, which both leaked the admin key and did not work for anyone.

## The version increments even when publishing fails

The CDN serves the version as its ETag. If a failed publish left the version
unchanged, the next generate would produce different bytes under the same
number and caches would treat them as interchangeable.

The cost is version numbers with gaps. That is cheaper than two bundles
claiming one identity.

## Publishing is best effort

A CDN outage does not fail a generate. The bundle is still written and still
downloadable; the job records `failed` and offers a retry. A site owner is
never blocked by infrastructure they do not control.

## Chrome is the default engine, Lightpanda is a choice

Lightpanda uses roughly a twentieth of the memory because it has no rendering
engine, and the extractor never needed one: it reads the DOM through
`querySelector` and `textContent` and never asks for computed styles or
geometry.

Both engines were run over the demo shop and four public sites, including one
whose content is built by JavaScript. They proposed the same tools everywhere
except a real single-page app, where Lightpanda saw one extra form. It was a
superset, never a subset: it did not miss anything Chrome found.

Chrome stays the default because Lightpanda ships only nightly builds, so there
is no stable version to pin, and because that single-page app difference proves
the two do not always agree. The memory is there for anyone who wants it;
nobody gets the difference by surprise.

## Lightpanda's telemetry is switched off

It reports to `telemetry.lightpanda.io` unless told otherwise. This browser
exists to open other people's sites on their behalf, so it does not get to
report on that.

The upstream privacy policy lists URLs, cookies, headers and page content among
what is never collected, which is what made the browser usable for customer
sites at all. `LIGHTPANDA_DISABLE_TELEMETRY` covers both telemetry and crash
reports. The check is for the variable's presence, not its value, so `false`
disables it just as surely as `true`; `true` is used anyway, so the setting
still reads correctly if a later version starts parsing the value.

The image tag moves rather than being pinned, so security fixes keep arriving.
The trade is that behaviour can change under a pull, which is why the README
carries a check to run afterwards.

## The browser closes when nothing is using it

Warm is right while scans keep arriving, since a launch costs a second or two.
Forever is not: on the droplet, the container sat at 490 MB after a single scan
instead of falling back to 110 MB, on a machine shared with a production
service.

## A form found on many pages is one tool

Identity is what a form does — method, endpoint path, fields, intent — never
where it sits. The key used to include the CSS selector, so a cart form on
eight product pages arrived as eight tools with names no owner could read.

Merging keeps every selector rather than picking one, because a visitor could
be on any of those pages and the embed already tries a list in turn. A real
storefront went from thirteen tools to nine under Chrome, and seventeen to ten
under Lightpanda.

## Errors that are not the caller's fault answer 500

A filesystem error used to reach the client verbatim, path and all, under a 400.
Only a `JobError` carries a message meant for a caller; anything else is logged
and answered generically.

## Things deliberately not done

| Not done | Why |
| --- | --- |
| Auth on the write routes | The trust model is that the job id is the capability. Anyone who can construct the request already knows it |
| Rate limiting reads | The free plan's ceiling is the practical limit for now |
| Pinning the browser image digest | Would freeze security fixes on a fast-moving project |
| Custom domain for the CDN beyond beta | The hostname may still move; the UI says so |
| Version history, rotating public ids, R2 | Out of scope for the first release |
