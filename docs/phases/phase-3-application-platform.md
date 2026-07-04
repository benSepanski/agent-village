# Phase 3 — One-off applications, safely

Goal: an application like "an agent with its own Gmail inbox" is buildable as a
**one-off manifest app with zero platform changes** — and inherits a hard LLM
spend cap and honest observability from the platform. Email itself is
application-level: the platform ships general capabilities, and a Gmail-polling
reference app validates them.

Why this shape works with the existing run model: a mail-polling app is
short-burst (poll → process new messages → exit), so the scheduled
one-run-per-agent Fargate task fits as-is. No always-on service mode is needed
— that stays on the [roadmap](phase-2-plus.md) for daemon-style apps (e.g.
OpenClaw).

The step list is the Phase-2 audit's platform gaps, ordered safety-first:

| Step | Deliverable                                                                                                                                                  | Status |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 01   | Run-duration kill switch: `ecs:StopTask` watchdog at `manifest.timeoutMinutes` + `timeout` SIGKILL fallback in the entrypoint                                | ✅     |
| 02   | ADR: metered Anthropic access for sandbox apps (platform-held key behind an `ANTHROPIC_BASE_URL` gateway vs. key injection + provider-side cap)              | ✅     |
| 03   | Metered Anthropic access implemented per the ADR: per-call reserve/reconcile against `spendLimitUsd`, mid-run hard stop when exhausted                       | ✅     |
| 04   | Egress proxy port preservation (`SO_ORIGINAL_DST`): allowed hosts reachable on their real ports, enabling IMAPS:993 / SMTPS:465 / SMTP:587                   | 📋     |
| 05   | Generic `secret` tool grant: per-agent named secrets injected as env, ownership-checked like Notion/GitHub grants                                            | 📋     |
| 06   | Honest cost: reconcile sandbox Fargate spend to actual duration; month-to-date spend per agent in UI/CLI                                                     | 📋     |
| 07   | Live observability: log tailing (CLI + web) from the sandbox log group; real run events replacing the fabricated timeline; fix or delete the dead EMF alarms | 📋     |
| 08   | Reference app `examples/gmail-agent`: IMAP poll → metered Anthropic → SMTP reply, workspace-persisted seen-message state, manifest-only install              | 📋     |
| 09   | E2E: forced spend breach stops the app mid-run; forced hang is killed at timeout; run viewer shows actual (not estimated) cost for the run                   | 📋     |

## Step notes

- **01** — the cost model already _assumes_ this control exists (the flat
  reservation prices `timeoutMinutes` of compute); this step makes it true. An
  EventBridge Scheduler one-shot per launched task (created by the launcher,
  deleted by the lifecycle handler) calling `ecs:StopTask`, plus
  `timeout -k` around the app command in `entrypoint.sh` as defense in depth.
- **02/03** — the sharp edge: the egress proxy is SNI peek-and-splice, not
  MITM, so it **cannot** see or meter tokens inside TLS. The recommended shape
  is therefore a small metering gateway (Lambda function URL): the sandbox
  never receives the real key, `ANTHROPIC_BASE_URL` points at the gateway with
  a per-run token, and the gateway reserves before forwarding and reconciles
  from the response's `usage` — the same reserve→reconcile invariant the
  inline path has ([spend-reservation](../data-model/spend-reservation.md)).
  The Anthropic SDK honors `ANTHROPIC_BASE_URL`, so apps need no code changes.
  The alternative (inject the raw key as a grant, cap at the provider level)
  is simpler but moves the limit outside the platform; the ADR decides.
- **04** — `resolveTarget` in `proxy.mjs` hardcodes upstream 443/80. Read the
  original destination via `SO_ORIGINAL_DST` (iptables REDIRECT preserves it)
  and connect to the real port. Allowlist stays host-based; TLS-with-SNI on
  any port works (IMAPS/SMTPS), plaintext HTTP stays port-80-only. STARTTLS
  ports (587/143) begin as protocol chatter the peek can't classify — decide
  in-step whether to support them via allowlisted host+port passthrough or
  document TLS-wrapped ports as the supported path.
- **05** — mirrors the Notion/GitHub grant pattern but generic:
  `{ kind: 'secret', name: 'gmail-app-password', env: 'GMAIL_APP_PASSWORD' }`
  resolving `agent-village/<env>/agents/<agentId>/<name>`, guarded by the
  existing `assertGrantSecretOwned`. This removes the need for a new grant
  kind per tool — SES/Notion/GitHub stay as richer typed grants.
- **06** — the lifecycle handler already receives the task's start/stop
  timestamps in the EventBridge event; reconcile the flat reservation to
  actual duration there (same `finalizeSpend` delta the inline path uses).
  Month-to-date: Run ids are ULIDs (time-ordered), so a key-condition range
  query over the current month suffices — no new accumulator, no reset cron.
- **07** — smallest honest version: CLI `village logs --follow` and a web
  panel via `FilterLogEvents` on the run's log streams; persist real
  `sandbox.run.*` transitions on the Run record (the lifecycle Lambda already
  observes them) and render those instead of `RunTimeline.events.ts`'s
  interpolated fake timestamps; emit EMF for `runs.error` /
  `runs.spend_limit_exceeded` or delete the two inert alarms.
- **08** — proves "zero platform changes": a plain Node script synced in via
  the workspace (deps vendored or `npm ci` with `registry.npmjs.org` in
  `egressAllow`), running on the static base image — so it does **not** need
  the still-unimplemented `manifest.image`. Grants: one `secret` (Gmail app
  password — the agent's own Gmail account, 2FA + app password; avoids the
  OAuth testing-mode 7-day refresh-token trap). Egress: `imap.gmail.com`,
  `smtp.gmail.com`, npm registry if not vendoring. Guards live in the app
  (sender allowlist, `Auto-Submitted` loop suppression) — application-level
  policy stays application-level.
- **09** — the spend-breach test is the phase's acceptance test in miniature:
  with a low `spendLimitUsd`, the gateway must start rejecting mid-run and the
  run record must show `spend_limit_exceeded`-adjacent status with actual
  cost, not the flat estimate.

After each step: `pnpm lint && pnpm typecheck && pnpm test` stays green, and
`pnpm --filter @agent-village/infra synth:dev` must succeed without AWS
credentials.
