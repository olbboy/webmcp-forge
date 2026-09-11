#!/usr/bin/env bash
#
# Deploys the current origin/main to this droplet and measures what the build
# costs in memory while it runs.
#
# Runs on the HOST, not in a container — it drives docker compose and reads the
# host's own memory.
#
# The measurement exists because the build is the tightest moment of the whole
# procedure: it runs npm ci, playwright install and next build on a 2 GB box
# shared with someone else's production service. The floor is how close that
# came to nothing.
#
# The sampling interval is fixed here on purpose. It was changed by hand once,
# from four seconds to three, and that alone moved the number by enough to
# invent a trend that was not there — a finer sample finds troughs a coarser one
# walks past. Comparing runs means sampling them identically, so the interval is
# not a parameter.

set -euo pipefail

SAMPLE_SECONDS=1

REPO="${WEBMCP_REPO_DIR:-/opt/webmcp-forge}"
LOG="${WEBMCP_DEPLOY_LOG:-/var/log/webmcp-deploy-memory.log}"
PROFILE="${WEBMCP_COMPOSE_PROFILE:-lightpanda}"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

cd "$REPO"

dockerd_anon_mib() {
  local pid
  pid="$(pgrep -x dockerd | head -1)" || true
  [ -n "$pid" ] || { echo "0"; return; }
  awk '/^RssAnon/ {printf "%.0f", $2/1024}' "/proc/$pid/status"
}

available_mib() { free -m | awk 'NR==2{print $7}'; }

image_id() { docker image inspect -f '{{.Id}}' webmcp-forge:local 2>/dev/null || echo none; }

before_available="$(available_mib)"
before_dockerd="$(dockerd_anon_mib)"
before_image="$(image_id)"

log "deploying: available ${before_available} MB, dockerd ${before_dockerd} MiB"

git fetch origin --quiet
git reset --hard origin/main --quiet
commit="$(git log --oneline -1)"
log "at $commit"

samples="$(mktemp)"
# Sampled in the background for the whole build. Killed in a trap so an
# interrupted deploy does not leave it running.
( while :; do available_mib; sleep "$SAMPLE_SECONDS"; done > "$samples" ) &
sampler=$!
cleanup() { kill "$sampler" 2>/dev/null || true; rm -f "$samples"; }
trap cleanup EXIT INT TERM

started="$(date +%s)"
docker compose --profile "$PROFILE" up -d --build
elapsed=$(( $(date +%s) - started ))

kill "$sampler" 2>/dev/null || true
floor="$(sort -n "$samples" | head -1)"
after_dockerd="$(dockerd_anon_mib)"
after_image="$(image_id)"

# A build that reused every layer says nothing about what a build costs, and a
# floor from one would poison the series it is written into.
if [ "$before_image" = "$after_image" ]; then
  rebuilt="cached (image unchanged — this floor is not comparable)"
else
  rebuilt="rebuilt"
fi

log "floor ${floor} MB · ${elapsed}s · $rebuilt · dockerd ${before_dockerd} → ${after_dockerd} MiB"
printf '%s\tfloor=%s\tsample=%ss\tbuild=%ss\t%s\tdockerd=%s->%s\t%s\n' \
  "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$floor" "$SAMPLE_SECONDS" "$elapsed" \
  "$rebuilt" "$before_dockerd" "$after_dockerd" "$commit" >> "$LOG"

log "recorded in $LOG"
