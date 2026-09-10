# Testing

```bash
npm test        # 80 tests across 12 files, about 37 seconds
npm run lint
npx tsc --noEmit
```

No internet is required and there is no separate command for `cdn/`. The Worker
runs on workerd through wrangler's `createTestHarness`, driven from the same
vitest as everything else.

## What each file is for

| File | What it pins |
| --- | --- |
| `store.test.ts` | A save is never visible half-written, and leaves nothing behind |
| `scanner.test.ts` | Finds nav, search, forms and product cards on the fixture shop |
| `extract` via `scanner.test.ts` | Snapshot shape from a real page |
| `heuristics` via `form-merging.test.ts` | One form found on many pages is one tool |
| `names.test.ts` | Tool names stay within `[a-z0-9_]` and stay unique |
| `generator.test.ts` | The bundle registers tools, including when it runs mid-parse |
| `browser-lifetime.test.ts` | The browser is kept warm, then released, and survives a teardown race |
| `scanner-engine.test.ts` | Engine selection, and a readable error when Lightpanda is unreachable |
| `cdn-worker.test.ts` | The Worker: auth, cache headers, version guard, size cap, unpublish |
| `cdn-client.test.ts` | Supersede and serialisation, and that no token reaches an error message |
| `api.test.ts` | Scan through generate through fetching the bundle |
| `api-publish.test.ts` | Publish states, retries, and that a download never publishes |
| `hosted-embed.e2e.test.ts` | All three layers: real Worker, real routes, real browser loading by URL |

## The bar these are held to

A test that passes against broken code is worse than no test, because it
reports safety it does not provide. Several here exist because a mutation
survived and had to be caught:

- An auth test used a wrong token of a different length, so it never reached
  the constant-time comparison. A build that only compared lengths passed every
  auth test in the file.
- Nothing loaded the embed while the document was still parsing, which is where
  the docs tell owners to put the tag, so that branch was never executed.
- The supersede check inside the queue had no coverage until a test held one
  request open long enough for two others to line up behind it.

- Saving a job through a temporary file was first tested by watching the
  directory during a write. That caught a plain write reliably but caught a
  scratch file misnamed `.json` only one run in three. The invariant the backup
  actually depends on is the name, so the name is asserted directly and the
  racing test kept for the end-to-end property.

When adding behaviour worth trusting, break it on purpose and confirm something
turns red. The store fix was held against five mutations — plain write, missing
rename, `.json` scratch name, fixed scratch name, scratch in another directory
— each caught on every one of three runs.

## What the suite does not cover

**The Lightpanda path.** It needs a running container, so it is not automated.
It has been checked by hand: both engines run over the demo shop and four
public sites, the results compared, and the engine-selection logic
mutation-tested. Re-check by hand after changing `scanner.ts`.

**Production topology.** Tests exercise the code, not the deployment. The
network-namespace arrangement, the tunnel and the memory limits are verified by
the checks in the [deployment guide](./deployment-guide.md).

**Real customer sites.** The fixture shop is deliberately simple. Sites built by
JavaScript frameworks behave differently, and the two engines have already been
seen to disagree slightly on one.
