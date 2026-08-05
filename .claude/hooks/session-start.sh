#!/bin/bash
set -euo pipefail

# Prepares a Claude Code on the web session for this repo: installs the pnpm
# workspace so `pnpm check` runs, and brings up a Docker daemon so milestone
# fixture commands (e.g. `pnpm fixture:m1`) work. The managed containers ship
# docker/dockerd but do not start the daemon at boot.

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

pnpm install --prefer-offline

if ! docker info > /dev/null 2>&1; then
  if command -v dockerd > /dev/null 2>&1; then
    nohup dockerd > /tmp/dockerd.log 2>&1 &
    for _ in $(seq 1 30); do
      if docker info > /dev/null 2>&1; then break; fi
      sleep 1
    done
  fi
fi

# Docker is best-effort: without it the harness still runs, only the
# Docker-dependent fixture commands fail, and they say so themselves.
if docker info > /dev/null 2>&1; then
  docker image inspect node:22-alpine > /dev/null 2>&1 || docker pull --quiet node:22-alpine || true
else
  echo "warning: no Docker daemon; fixture commands needing one will fail (see /tmp/dockerd.log)" >&2
fi
