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

## The scan guard sits above the job, not inside the scanner

Two functions are called `runScan`. The route calls the one in `jobs.ts`, which
catches everything `scanSite` throws and records it as a failed job, so an
address refused down in the scanner came back as a 422 carrying a job object.
The check therefore runs in `jobs.ts`, beside `parseScanUrl` and before the
pending job is written: a refused probe answers 400 and leaves nothing on disk.

A refusal is also re-thrown rather than caught. Both catch blocks on the way out
turn an error into an empty page and carry on, which for a blocked address means
the scan finishes, tools are proposed, and the API answers 200 for a site it was
never allowed to open.

## What the second check can see depends on the browser

The strong check reads the peer address off the response: the address that was
actually dialled, which closes redirects and DNS rebinding together. Chrome
reports it. Lightpanda, measured against the image this deployment runs, returns
null for every response.

So the second check follows the engine. Under Lightpanda it re-resolves every
URL in the redirect chain instead, which still refuses a redirect into the
private network but cannot see a name whose answer changes between our lookup
and the browser's. That gap is real; it is the price of the engine that costs
twenty megabytes instead of three hundred and fifty.

Playwright's request interception is not a substitute here. It registers under
Lightpanda and fires, but the route object has no `url()`, so there is nothing
to decide on — and installing it makes navigation hang.

## Scanning yourself is exempt, but only while developing

The "Try the demo shop" button asks for a URL on the address the app is
answering on. Deployed that is a public hostname the guard allows anyway, so the
exemption is only ever needed in development, where the app answers on loopback.

Working out which address that is turned out to be the awkward part. Next
rewrites `request.url` to `localhost` whatever the browser asked for, and
`localhost` and `127.0.0.1` are different origins, so the URL is no use; the
`Host` header is the only record of what the caller actually typed. That header
is set by the caller, which is precisely what must not be allowed to wave a URL
past this check — so rather than trying to validate it, the exemption is off
entirely when `NODE_ENV` is production.

## The escape hatch announces itself, and redirects never inherit it

The test suite scans a fixture on 127.0.0.1, so the guard needs a way off. It is
an environment variable rather than a code path, and it prints a warning the
first time it is read: checking it at deploy time does nothing about someone
adding it to `.env` months later to debug one site.

The two checks read separate variables. Sharing one is how a test for the second
check passes because the first one refused, and keeps passing after the second
is deleted.

A redirect target never inherits the hatch. The hatch exists so this project can
point the scanner at a fixture it runs itself; where a redirect leads is chosen
by the site being scanned.

## The scan limits are counted in this process, not in front of it

Cloudflare's free plan allows one rate-limiting rule with a counting window of
ten seconds, which stops a flood and cannot express "one scan a minute". Next.js
16 renamed middleware to proxy and its documentation asks callers not to rely on
shared modules or globals there, since it is meant to be deployable to a CDN. So
the counters live in the route handler, which already declares the Node runtime.

That rests on there being one process to count in. There is: the container runs
a single `next-server`. Two instances would each count on their own and this
would stop being a limit.

The concurrency ceiling is checked before the per-address allowance. A caller
turned away because the box is busy has not had a scan, and should not be
charged for one.

## An agent may press what the scan saw, and nothing else

`click_by_text` matched any substring against every clickable element on the
page, and pressed the first hit. "delete" reached "Delete account"; "buy"
reached "Buy now". Beside it, the form tool needed two separate flags before it
would submit. Same bundle, two different standards.

It now carries the labels found during the scan and accepts an exact match
against that list, then locates the element by the list entry rather than by the
caller's string — looking it up by what the caller sent would leave the check
decorative. Substring matching is gone entirely: kept as a fallback it would
reproduce the original defect inside a shorter list. A page with nothing to
press gets no tool at all.

The list gathers buttons first and links second, because both have always been
clickable at call time and the list is capped: a page with eighty links would
otherwise push its real buttons off the end.

A job scanned before any of this existed has no list, and bundles are rebuilt
from the candidates stored on the job. Missing is therefore treated differently
from empty — missing means an older scan, and the labels are recovered from the
pages that job already holds.

## Safety hints are sent, and are not the safety

The tools carried a `readOnlyHint` that never left the manifest: the embed
registered name, description, schema and function, and dropped the rest. They
are passed through now, using the WebMCP draft's own vocabulary —
`readOnlyHint`, `untrustedContentHint`, `consequentialHint` — which is not MCP's
set. Only the first name appears in both.

They are advice to the client, and clients honour them unevenly; a tool that
claims to be read-only can do whatever it likes. So they are labelling, not
enforcement, and every gate that actually stops something lives in the embed's
own code.

## The limits are three a minute-ish, not one

One scan per thirty seconds was the safe opening bid, and it was wrong by a
little in a way that only shows in use: a refused request spends its allowance
too — deliberately, so the endpoint cannot be probed for free — which meant a
mistyped URL cost you the next half minute as well.

Three in a window covers the way the tool is actually used: paste a URL, read
the tools, change something, try again. Sixty a day is the same adjustment
carried through, because three a window against a ceiling of twenty just moves
the wall from thirty seconds to three minutes.

A 429 says which limit it was. `Retry-After` of about thirty seconds is the
window; thousands of seconds is the daily ceiling, counting down to midnight
UTC.

## A full counter map refuses rather than evicts

The per-address counters live in a bounded map, and something has to give when
it fills. Evicting the oldest entry turned out to be a way to clear your own
daily count: reach the ceiling, then send traffic from enough fresh addresses
that the entry counting your scans is the one thrown out. Least-recently-used
does not help either — the flooder simply stops touching their own key while
the flood runs.

So a map full of live counters refuses the new key instead of making room.
Expired entries are still dropped for free, and the ceiling is set high enough
that ordinary use never approaches it.

The cost is deliberate: past that many distinct callers within one window, a new
caller waits. On a service where a busy day is dozens of scans, that is
somewhere a flood can reach and real traffic cannot, and the alternative is a
daily limit that anyone can reset.

## A slot belongs to the scan, not to the request

The concurrency slot used to be released when the request stopped waiting. Those
are not the same moment: past the hard timeout the caller gets an answer while
the scan carries on with a browser open. Handing the slot back there advertises
capacity that does not exist.

It is released when the scan itself settles now. A request that never reached
the scan — turned away on its address allowance — still releases on the way out,
because there is no work to wait for.

Acquiring a browser also has a timeout at last. Launching one, or connecting to
one over CDP, was the only wait on the scan path with none of its own, and a
hang there held the request and its slot until the process restarted.

## One bad linked page is not a bad scan

A refusal from the second guard has to reach the caller when it is the home page
that was refused: nothing was read, so there is nothing to return. A linked page
is different. The pages already gathered are worth returning, and the scan
records the refused one as an error and carries on — which is what it does for
any other page that fails to load.

## The health check reports and does not repair

A tool whose selector no longer matches is the failure this project is most
exposed to: the selectors are a photograph of a site's markup, and nothing tells
anyone when the photograph stops resembling the site.

The check re-opens the pages the scan recorded and asks, for each tool, whether
its target is still findable. It stops there. Re-scanning would be the obvious
next step and it is the wrong one: the tools on a live site were chosen and
sometimes renamed by their owner, and replacing them because a selector moved
would undo that silently.

Two things it refuses to say. If no page opens it returns an error rather than a
report, because "all your tools are dead" is exactly wrong when a site was down
for a minute, and a false alarm of that size is how the real one gets ignored.
If some pages open and others do not, the report says so and every negative
verdict carries the caveat, since the page that would not open might have been
the one holding that selector.

It takes a concurrency slot like a scan, because it opens a browser like a scan.
Without that it would be a way around the ceiling that keeps this box usable for
the service sharing it.

## A re-scan proposes, it does not replace

Re-scanning had one honest answer until now: start a new scan, get a new job,
paste a new script tag, and set every tool up again. The tag is the part that
makes it expensive — it is already on somebody's pages, and it carries the job's
public id. So a re-scan keeps the job: same id, same public id, same tag.

Keeping the job is what forces the rest of the design. The tools in it were
chosen, renamed and sometimes deliberately switched off by their owner, and a
scan finding different markup is a reason to ask them, not a reason to decide.
So the scan is parked on the job as a proposal with a list of differences, and
nothing moves until somebody answers.

What the difference is computed from is deliberately narrow: the selectors and
the click allowlist, not names or descriptions. The owner is allowed to rename a
tool, and a scan re-deriving the original name must not report that back to them
as something their site did.

Accepting keeps the name and the switch for every tool that survived. A tool
found for the first time arrives switched **off**. It has never been looked at,
and a tool nobody chose should not start answering agents on a customer's site
because the markup moved.

Accepting also bumps the version and deletes the generated files. The files were
built from the tools that were there a moment ago, and serving them as this
job's bundle would be a lie about what it contains — but the copy already on the
CDN keeps serving, because the customer's site should not change under them
until they generate again. The version moves even though nothing was published,
because a rebuild of a missing artifact reads the version off the job: left
alone, one number would come to mean two different bundles, and that number is
what the CDN hands out as its cache validator. The last health check is dropped
at the same time, since its verdicts were about tools that may no longer exist.

When nothing differs, the panel offers no way to accept. Accepting a no-op would
delete a bundle that is still correct and make its owner generate again for
nothing.

It takes a concurrency slot, because it opens a browser. It takes no per-address
allowance: reaching it means holding the job id, which is the owner's key, and
an owner re-scanning their own site is not the traffic that limit exists for.

## The job page says who can actually call these tools

The pitch for this product is that agents can use your site. The honest answer
to "which agents, today?" is narrower than that, and an owner deciding whether
to put a script tag on their pages should read it before they do rather than
work it out later: today it is mostly people using ChatGPT.

So the job page carries that table, with the date it was checked on it. The date
is the point. The answer moves — an origin trial ends, an extension ships
discovery — and a confident table with no date is how a page ends up quietly
lying to the people who trusted it. It is not checked automatically, so it says
that too, and says to test anything marked "not yet" rather than believe it.

The bundle is worth pasting anyway, and the table says why: the tools cost
nothing while nobody calls them, and the tag does not have to be re-pasted when
the rest catch up.

## The embed does not create the pre-standard global

The draft settled on `document.modelContext`. `navigator.modelContext` is where
the earlier providers put it, and the bundle used to mirror its context onto
that name as well.

It no longer does. Nothing we recommend reads it — the local relay we hand
people for Cursor and Claude Desktop reads `document.modelContext` only, checked
by opening the published bundle — so the mirror was adding a non-standard global
to a page we are a guest on and getting nothing back for it.

Reading it survives, and only reading. If a page already has a context under the
old name, registering into that one puts the tools where its provider can see
them, which costs a single `||`. Creating the name is what stopped.

## Things deliberately not done

| Not done | Why |
| --- | --- |
| Auth on the write routes | The trust model is that the job id is the capability. Anyone who can construct the request already knows it |
| Rate limiting reads | The free plan's ceiling is the practical limit for now |
| Reading the stored log records to confirm redaction | The runtime redacts before the trace event leaves it, and the live stream shows the publish token already gone. Closing the remaining gap would mean issuing a token with observability read purely to check |
| Pinning the browser image digest | Would freeze security fixes on a fast-moving project |
| Custom domain for the CDN beyond beta | The hostname may still move; the UI says so |
| Version history, rotating public ids, R2 | Out of scope for the first release |
