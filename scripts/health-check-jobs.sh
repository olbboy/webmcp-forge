#!/usr/bin/env bash
#
# Asks the app to re-check every published job's tools against its live site.
# Run from cron on the droplet; see docs/deployment-guide.md.
#
# Only published jobs are checked. An unpublished one has no bundle on anyone's
# site, so a stale selector there costs nobody anything, and checking it would
# spend a browser on it.
#
# Nothing here fixes anything. It reports, and a tool that has lost its target
# stays exactly as it is until its owner decides what to do — re-scanning would
# change tools that a site owner approved.

set -euo pipefail

JOBS="${WEBMCP_JOBS_DIR:-/opt/webmcp-forge/data/jobs}"
APP="${WEBMCP_APP_URL:-http://127.0.0.1:43127}"
# The endpoint takes a concurrency slot, so two of these running at once would
# spend the whole ceiling on housekeeping. Waits rather than gives up.
RETRY_WAIT="${WEBMCP_HEALTH_RETRY_WAIT:-45}"
RETRIES="${WEBMCP_HEALTH_RETRIES:-4}"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

[ -d "$JOBS" ] || { log "ERROR: job store $JOBS does not exist"; exit 1; }

checked=0
attention=0
skipped=0
failed=0

for file in "$JOBS"/*.json; do
  [ -e "$file" ] || break
  id="$(basename "$file" .json)"

  # Published means a bundle is live somewhere. Anything else is not worth a
  # browser.
  if ! grep -q '"publishStatus": *"published"' "$file"; then
    skipped=$((skipped + 1))
    continue
  fi

  attempt=0
  while :; do
    body="$(mktemp)"
    # curl prints 000 of its own accord when it never got a response, and
    # exits non-zero as well; a fallback echo here would append a second 000.
    code="$(curl -s -o "$body" -w '%{http_code}' -X POST "$APP/api/jobs/$id/health" --max-time 180)" || true
    [ -n "$code" ] || code="000"

    if [ "$code" = "429" ] && [ "$attempt" -lt "$RETRIES" ]; then
      # The ceiling is busy with a real scan. A customer waiting on one of
      # those matters more than this does.
      attempt=$((attempt + 1))
      rm -f "$body"
      sleep "$RETRY_WAIT"
      continue
    fi

    if [ "$code" = "200" ]; then
      # Counted by reading the report back rather than by trusting the status
      # code: a 200 only says the check ran.
      broken="$(python3 -c '
import json, sys
report = json.load(open(sys.argv[1])).get("health") or {}
tools = report.get("tools") or []
bad = [t for t in tools if t.get("status") != "ok"]
print(len(bad))
for t in bad:
    print("    " + t.get("status", "?") + "  " + t.get("name", "?") + "  " + (t.get("detail") or ""))
' "$body")"
      count="$(printf '%s' "$broken" | head -1)"
      checked=$((checked + 1))
      if [ "$count" != "0" ]; then
        attention=$((attention + 1))
        log "$id: $count tool(s) need attention"
        printf '%s\n' "$broken" | tail -n +2
      fi
    else
      # 502 is the site being unreachable, which the app refuses to read as
      # "every tool is dead". Worth a line, not worth an alarm.
      failed=$((failed + 1))
      log "$id: check did not complete (HTTP $code)"
    fi
    rm -f "$body"
    break
  done
done

log "done: $checked checked, $attention needing attention, $failed incomplete, $skipped not published"

# A non-zero exit would make cron mail on a perfectly ordinary result. The
# findings are in the log; failing is reserved for not being able to look.
exit 0
