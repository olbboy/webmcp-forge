# Deployment guide

What is running in production, how to change it, and what to check afterwards.

## What exists

| Thing | Value |
| --- | --- |
| App | `https://app.webmcps.net` |
| CDN | `https://cdn.webmcps.net`, also `webmcp-forge-cdn.minhdatplus.workers.dev` |
| Host | DigitalOcean droplet `vtb-vps`, `188.166.228.230`, sgp1, 2 vCPU / 2 GB |
| Checkout | `/opt/webmcp-forge`, tracks `main` |
| Worker | `webmcp-forge-cdn` |
| KV namespace | `webmcp-forge-cdn-EMBEDS`, id `1cf2b3f500f44d76be68bc177a1d88ac` |
| Tunnel | `webmcp-forge`, id `973b70ad-bb67-4a0f-9504-c4384577d4cc` |
| Apex `webmcps.net` | **Untouched.** Still two old A records, still not serving |

The droplet also runs an unrelated production service. Nothing here publishes a
port to the host: a Cloudflare Tunnel reaches the app over the compose network,
so no inbound port opens and the droplet's address stays out of DNS.

## Environment

Read at runtime, never baked into an image.

| Variable | Meaning |
| --- | --- |
| `CDN_BASE_URL` | Worker origin. Empty disables publishing; owners self-host instead |
| `CDN_PUBLISH_TOKEN` | Must equal the Worker's `PUBLISH_TOKEN` secret |
| `TUNNEL_TOKEN` | Cloudflare Tunnel credential |
| `SCANNER_ENGINE` | `chrome` (default) or `lightpanda` |
| `SCANNER_CDP_URL` | Where Lightpanda listens. `http://127.0.0.1:9222` |
| `BROWSER_IDLE_MS` | Idle wait before the browser is closed. Default five minutes |
| `BROWSER_ACQUIRE_TIMEOUT_MS` | How long to wait for a browser before giving up. Default 20000 |
| `WEBMCP_DATA_DIR` | Job storage. `/data` in the container |
| `SCAN_RATE_WINDOW_MS` | Rate-limit window. Default 30000 |
| `SCAN_RATE_MAX_PER_WINDOW` | Scans per address per window. Default 3 |
| `SCAN_RATE_MAX_PER_DAY` | Scans per address per UTC day. Default 60. A 429 carrying a `Retry-After` of thousands of seconds is this one; around thirty seconds is the window above |
| `SCAN_RATE_UNKNOWN_PER_DAY` | Ceiling for callers whose address could not be read, shared by all of them. Default 200 |
| `SCAN_MAX_CONCURRENT` | Scans running at once. Default 1; raise only against a measurement of that many in parallel |
| `SCAN_RATE_MAP_MAX` | How many distinct callers each counter map holds. Default 20000. Once full of live counters, new callers are refused rather than evicted — evicting is how a caller clears their own count |
| `SCAN_RATE_LIMIT_DISABLED` | `1` switches the limits off. The test suite sets it; production must not |
| `SCAN_ENFORCE_CONNECTED_IP` | `0` switches off the check that runs after navigation. A way to undo it without rebuilding |
| `SCAN_ALLOW_PRIVATE_HOSTS` | `1` lets the scanner reach private addresses. **Never set in production.** The app logs a warning at startup while it is on, so `docker compose logs app` will say so |

Live values are in `/opt/webmcp-forge/.env` on the droplet, mode 600. A copy
from before the Lightpanda switch is at `.env.bak.before-lightpanda`.

## Deploying a change

```bash
ssh vtb-vps
cd /opt/webmcp-forge
git fetch origin && git reset --hard origin/main
npm run cdn:deploy                        # only when cdn/ changed
docker compose --profile lightpanda up -d --build
```

Drop `--profile lightpanda` if the browser service is not in use, and drop
`--build` when only configuration changed.

Then confirm, from anywhere:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://app.webmcps.net/
```

Recreating the app briefly interrupts it. There is no blue-green step.

## Rolling back

The image is assembled on the droplet, so rolling back means checking out the
previous commit and repeating the deploy:

```bash
git reset --hard <previous commit>
docker compose --profile lightpanda up -d --build
```

Jobs live in `./data`, a bind mount, and survive both.

## Backups

`scripts/backup-jobs.sh` runs from root's crontab at 18:00 UTC, which is 01:00
in Saigon:

```
0 18 * * * /opt/webmcp-forge/scripts/backup-jobs.sh >> /var/log/webmcp-forge-backup.log 2>&1
```

Archives land in `/backups/webmcp-forge`, newest fourteen kept. That path is
outside the checkout on purpose: a deploy runs `git reset --hard`, and backups
should not be within reach of it.

Each archive is unpacked and every job parsed before it counts as a backup.
Saves go through a temporary file and a rename, so `tar` should never meet a
half-written job, but `tar` reports success over a truncated file either way
and an archive nobody has opened is only a file. A run that fails verification
retries once, then exits non-zero leaving no new archive. It builds under a scratch name and renames only on success, so
a failed run cannot damage the archives already held.

Restoring, with the app stopped so it does not write underneath the copy:

```bash
docker compose stop app
tar -xzf /backups/webmcp-forge/jobs-<timestamp>.tar.gz -C /tmp
cp /tmp/jobs/*.json /opt/webmcp-forge/data/jobs/
docker compose start app
```

Check `/var/log/webmcp-forge-backup.log` after any change to the job store.

## Cloudflare resources

Creating them again from scratch:

```bash
npx wrangler login
npx wrangler kv namespace create EMBEDS -c cdn/wrangler.jsonc   # id → wrangler.jsonc
npx wrangler secret put PUBLISH_TOKEN -c cdn/wrangler.jsonc     # openssl rand -hex 32
npm run cdn:deploy
```

The custom domain and its certificate are created by the deploy, from the
`routes` entry in `cdn/wrangler.jsonc`. Preview URLs are off: they keep an
older version of the Worker reachable with the current secret, so a fix to the
token check would stay bypassable at the previous version's address.

## Running with Lightpanda

Optional, behind a compose profile, so a plain `up` leaves it alone.

```bash
docker compose --profile lightpanda up -d
docker compose logs lightpanda | grep "telemetry status"   # must say disabled=true
```

The browser shares the app's network namespace. That is not a style choice: it
refuses a WebSocket whose `Host` header is an arbitrary name, as protection
against DNS rebinding, and accepts only an IP or `localhost`. Container IPs are
not stable, so the app's own loopback is the one address that is both accepted
and predictable.

The cost is that recreating the app destroys the browser container's network.
Bring them up together rather than restarting the app alone.

## Limits to keep in view

| Limit | Value |
| --- | --- |
| Droplet memory | 2 GB total, plus a 2 GB swapfile at swappiness 10 |
| App container | 900 MB, 1.5 GB with swap |
| Lightpanda container | 256 MB |
| Workers free plan | 100,000 requests a day |
| KV free plan | 100,000 reads, 1,000 writes a day, one write per second per key |
| Propagation | About seven minutes for a republish or unpublish to reach visitors |

Chrome costs roughly 350 MB during a scan; Lightpanda about 20 MB. On a shared
2 GB box that difference is the reason the engine is a choice at all.

Measured on 2026-09-11 under Lightpanda, with two scans of real sites running
at once: the app container peaked at 175 MB of its 900 MB cap and the browser
container at 56 MB of its 256 MB. `SCAN_MAX_CONCURRENT` is set to 2 on the
strength of that measurement. Raising it further wants the same measurement
again at the new number — the ceiling that matters is `memory.current` of both
cgroups, not `anon`, and not what `docker stats` reports.

## Checks that have earned their place

- `docker compose logs lightpanda | grep "telemetry status"` after any image
  pull. The tag moves, and the setting that stops the browser reporting on
  customer sites is undocumented upstream.
- `free -m` after a deploy. The neighbouring service has no protection beyond
  the container memory limits.
- `docker stats` reports the cgroup total, which includes page cache. To see
  what the app actually holds, read `anon` from the cgroup's `memory.stat`.
- Credentials belong in `Authorization`, nowhere else. The runtime redacts a
  logged header only when its name is `cookie`/`set-cookie` or contains `auth`,
  `key`, `secret`, `token` or `jwt`. Verified against the deployed Worker; the
  reasoning and its limits are in [cdn/README.md](../cdn/README.md).

## Not done yet

- `ufw` is inactive. Nothing here opens a port, so this is unchanged rather
  than made worse.
