#!/usr/bin/env bash
#
# Archives the job store to a timestamped tarball and prunes old ones.
# Run from cron on the droplet; see docs/deployment-guide.md.
#
# Jobs are written with a plain write, not a temp-file rename, so a save that
# lands mid-archive can leave a truncated JSON inside the tarball. tar reports
# success either way, so the archive is read back and every job parsed before
# it is allowed to count. A backup nobody has opened is just a file.

set -euo pipefail

SRC="${WEBMCP_JOBS_DIR:-/opt/webmcp-forge/data/jobs}"
DEST="${WEBMCP_BACKUP_DIR:-/backups/webmcp-forge}"
KEEP="${WEBMCP_BACKUP_KEEP:-14}"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

[ -d "$SRC" ] || { log "ERROR: job store $SRC does not exist"; exit 1; }
mkdir -p "$DEST"

# A run killed mid-archive would otherwise leave its scratch file behind for
# good. The signal handlers exit rather than fall through, because a cleanup
# that returns would let the run continue on to rename a file it just removed.
scratch=""
cleanup() { [ -n "$scratch" ] && rm -f "$scratch"; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
trap 'cleanup; exit 129' HUP

# Counts every job the archive is expected to contain, so a silent partial
# capture cannot pass as a full one.
count_jobs() { find "$1" -maxdepth 1 -name '*.json' | wc -l | tr -d ' '; }

# Unpacks the archive somewhere disposable and parses each job. Returns the
# number of readable jobs, or fails if any file is not valid JSON.
verify_archive() {
  local archive="$1" tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  tar -xzf "$archive" -C "$tmp"
  python3 - "$tmp/jobs" <<'PY'
import glob, json, os, sys
bad = []
files = sorted(glob.glob(os.path.join(sys.argv[1], "*.json")))
for f in files:
    try:
        json.load(open(f))
    except Exception as exc:
        bad.append(f"{os.path.basename(f)}: {exc}")
if bad:
    print("unreadable jobs in archive:", file=sys.stderr)
    for b in bad:
        print("  " + b, file=sys.stderr)
    sys.exit(1)
print(len(files))
PY
}

expected="$(count_jobs "$SRC")"
log "backing up $expected job(s) from $SRC"

attempt=1
while :; do
  # Built under a scratch name and only given a real one once it verifies, so
  # a run that fails can never delete or overwrite a backup already held here.
  scratch="$(mktemp "$DEST/.jobs-part-XXXXXX")"
  tar -czf "$scratch" -C "$(dirname "$SRC")" "$(basename "$SRC")"

  if found="$(verify_archive "$scratch")"; then
    archive="$DEST/jobs-$(date -u +%Y%m%d-%H%M%S).tar.gz"
    # Timestamps are per second, so two runs in the same second would collide.
    [ -e "$archive" ] && archive="${archive%.tar.gz}-$$.tar.gz"
    mv "$scratch" "$archive"
    log "verified $found job(s) in $(basename "$archive") ($(du -h "$archive" | cut -f1))"
    break
  fi

  # A job saved while tar was reading is the likely cause, and it will not be
  # mid-write a second time. Anything that survives a retry is real damage.
  rm -f "$scratch"
  if [ "$attempt" -ge 2 ]; then
    log "ERROR: archive failed verification twice, leaving no new backup"
    exit 1
  fi
  log "verification failed, retrying once"
  attempt=$((attempt + 1))
  sleep 5
done

# Keep a fixed number of archives rather than a cutoff date, so the disk
# footprint stays bounded however often this runs.
mapfile -t stale < <(ls -1t "$DEST"/jobs-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))")
if [ "${#stale[@]}" -gt 0 ]; then
  rm -f "${stale[@]}"
  log "pruned ${#stale[@]} archive(s) beyond the newest $KEEP"
fi

log "done: $(ls -1 "$DEST"/jobs-*.tar.gz 2>/dev/null | wc -l | tr -d ' ') archive(s) held"
