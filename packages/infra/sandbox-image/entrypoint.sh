#!/usr/bin/env bash
# Wraps every sandboxed application run: pulls the durable workspace down from
# S3, runs the application, and syncs the workspace back — including when the
# application fails or the task is stopped (SIGTERM). The application only ever
# sees a plain directory; all S3 awareness lives here.
set -euo pipefail

: "${AV_WORKSPACE_URI:?AV_WORKSPACE_URI is required (s3://bucket/ownerSub/agentId/)}"
WORKSPACE_DIR="${AV_WORKSPACE_DIR:-/workspace}"
FLUSH_SECONDS="${AV_FLUSH_SECONDS:-300}"

# Mirrors the structured-log envelope (event names are in the LOG_EVENTS enum).
log() {
  printf '{"event":"%s","service":"sandbox","time":"%s"%s}\n' \
    "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${2:-}"
}

sync_up() {
  aws s3 sync "$WORKSPACE_DIR" "$AV_WORKSPACE_URI" --delete --no-progress > /dev/null
}

mkdir -p "$WORKSPACE_DIR"
aws s3 sync "$AV_WORKSPACE_URI" "$WORKSPACE_DIR" --no-progress > /dev/null
log sandbox.run.sync_down

FLUSHER_PID=""
if [ "$FLUSH_SECONDS" != "0" ]; then
  (
    while true; do
      sleep "$FLUSH_SECONDS"
      if sync_up; then log sandbox.run.flush; fi
    done
  ) &
  FLUSHER_PID=$!
fi

"$@" &
APP_PID=$!
trap 'kill -TERM "$APP_PID" 2> /dev/null || true' TERM INT

# `wait` returns early when a trapped signal arrives; loop until the
# application has actually exited so APP_EXIT is its real status.
set +e
while true; do
  wait "$APP_PID"
  APP_EXIT=$?
  kill -0 "$APP_PID" 2> /dev/null || break
done
set -e
trap - TERM INT
log sandbox.run.app_exited ",\"exitCode\":${APP_EXIT}"

if [ -n "$FLUSHER_PID" ]; then
  kill "$FLUSHER_PID" 2> /dev/null || true
fi

# Final flush is load-bearing: if it fails the run must not look successful.
sync_up
log sandbox.run.sync_up
exit "$APP_EXIT"
