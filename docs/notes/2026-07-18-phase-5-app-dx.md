# Phase 5 (external app DX) — implementation handoff — 2026-07-18

Handoff after implementing all seven steps of
[phase-5-app-dx](../phases/phase-5-app-dx.md) in one session on
`claude/agent-village-app-ready-8a2326`. The platform is now drivable end to
end from a separate app repo with only the `village` CLI — no AWS
credentials, no monorepo checkout.

## What landed (per-step details in the phase doc)

- **Workspace API + CLI** — list + batch-presign routes, ownership asserted
  via the agent record before any S3 access; `village workspace
push/pull/ls/rm`.
- **`village login` / `logout`** — new Cognito `CliClient`
  (`USER_PASSWORD_AUTH`, `CliClientId` stack output), `SOFTWARE_TOKEN_MFA`
  challenge supported, refresh token in the OS keychain (0600 plaintext
  fallback), CLI config persisted at `~/.config/agent-village/config.json`.
- **`village agents create/update/rm`** — JSON-file driven, local Zod parse
  before the HTTP call.
- **Installable CLI** — `pnpm cli:pack` → single-file esbuild bundle packed
  as an `npm i -g`-able tarball (`@napi-rs/keyring` stays an optional native
  dep).
- **`village init`** — scaffolds a new app repo (manifest.json, app.mjs,
  agent.json, README, .gitignore) whose files parse against the shared
  schemas.
- **Docs** — [app-development.md](../app-development.md) (the external
  app-builder guide + driving-app fit table), gmail-agent README moved to
  the CLI flow, indexes/roadmap updated.

## Adversarial review (same session)

A 4-dimension multi-agent review (security / correctness / infra / docs)
with per-finding skeptical verification confirmed 7 findings; **all 7 fixed
in-session**: plaintext credential fallback now 0600/0700; `workspace pull`
surfaces listing truncation; the presign handler dropped from `write` to
`read` perms (no unneeded Secrets Manager CRUD); a false comment
cross-reference in auth-stack corrected; stale step/phase statuses fixed;
the bucket-wide presign IAM grant documented as an accepted limit
([agent-state-isolation](../key-properties/agent-state-isolation.md)) with
STS-narrowed presigning on the roadmap backlog.

## For the next session

- **apply-bot port** is unblocked: build the Python image
  ([examples/python-sandbox-image](../../examples/python-sandbox-image/)),
  push as a tag, `village init` the repo shape, set `manifest.image`.
- OpenClaw-style daemons still need the phase-6+ daemon runtime; everything
  else in the driving-app list fits the batch model today.
- Not exercised against a live AWS deployment this session (no credentials):
  the full `village login → init → push → run` loop deserves one manual
  smoke pass on dev after deploy.
