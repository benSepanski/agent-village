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

| Step | Deliverable                                                                                                                                                                                                           | Status |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 01   | Run-duration kill switch: `ecs:StopTask` watchdog at `manifest.timeoutMinutes` + `timeout` SIGKILL fallback in the entrypoint                                                                                         | ✅     |
| 02   | ADR: metered Anthropic access for sandbox apps (platform-held key behind an `ANTHROPIC_BASE_URL` gateway vs. key injection + provider-side cap)                                                                       | ✅     |
| 03   | Metered Anthropic access implemented per the ADR: per-call reserve/reconcile against `spendLimitUsd`; when exhausted, further LLM calls 402 mid-run (compute continues until exit or the step-01 watchdog — ADR 0004) | ✅     |
| 04   | Egress proxy port preservation (port-mapped REDIRECT): allowed hosts reachable on their real ports, enabling IMAPS:993 / SMTPS:465 (STARTTLS 587/143 unsupported)                                                     | ✅     |
| 05   | Generic `secret` tool grant: per-agent named secrets injected as env, ownership-checked like Notion/GitHub grants                                                                                                     | ✅     |
| 06   | Honest cost: reconcile sandbox Fargate spend to actual duration; month-to-date spend per agent in UI/CLI                                                                                                              | ✅     |
| 07   | Live observability: log tailing (CLI + web) from the sandbox log group; real run events replacing the fabricated timeline; fix or delete the dead EMF alarms                                                          | ✅     |
| 08   | Reference app `examples/gmail-agent`: IMAP poll → metered Anthropic → SMTP reply, workspace-persisted seen-message state, manifest-only install                                                                       | ✅     |
| 09   | E2E: forced spend breach cuts off the app's LLM access mid-run (402s; compute runs on until exit/watchdog); forced hang is killed at timeout; run viewer shows actual (not estimated) cost                            | ✅     |

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
- **04** — done via **port-mapped REDIRECT**, not `SO_ORIGINAL_DST`: Node has
  no `getsockopt()`, so reading the original destination would have required a
  native/ffi dependency. Instead `entrypoint.sh` REDIRECTs each supported
  original port to a distinct local listener (80→15080, 443→15443, 465→15465,
  993→15993) and the proxy infers the original port from which listener
  accepted; all other TCP ports hit a catch-all listener and are denied.
  Allowlist stays host-based; TLS-with-SNI works on 443/465/993
  (IMAPS/SMTPS), plaintext HTTP stays port-80-only. **STARTTLS (587/143) is
  unsupported**: those are server-speaks-first protocols (no client bytes to
  peek a hostname from), and the port-mapped design cannot recover the
  original destination IP for a blind passthrough — apps must use the
  implicit-TLS ports (SMTPS 465, IMAPS 993), which Gmail supports (step 08).
  Design rationale documented atop `proxy.mjs`; the entrypoint↔proxy port map
  is lockstep-guarded by `packages/infra/test/proxy-allowlist.test.ts`.
- **05** — mirrors the Notion/GitHub grant pattern but generic:
  `{ kind: 'secret', name: 'gmail-app-password', env: 'GMAIL_APP_PASSWORD' }`
  resolving `agent-village/<env>/agents/<agentId>/<name>`, guarded by the
  existing `assertGrantSecretOwned`. This removes the need for a new grant
  kind per tool — SES/Notion/GitHub stay as richer typed grants. As built: the
  manifest carries only the kebab-case leaf `name` (charset-validated, no `/`),
  so the full secret name is always derived under the agent's own prefix —
  ownership holds by construction, with the assert kept as defense in depth.
  The `env` var is Zod-validated (`^[A-Z][A-Z0-9_]*$`) against a
  platform-reserved denylist (`AV_*`, `ANTHROPIC_*`, `AWS_*`, grant-injected
  names like `NOTION_TOKEN`, plus `PATH`/proxy vars the entrypoint depends
  on — `isReservedSandboxEnv` in `shared/src/schemas/manifest.ts`), and
  duplicate `env` names across secret grants in one manifest are rejected.
- **06** — the lifecycle handler already receives the task's start/stop
  timestamps in the EventBridge event; reconcile the flat reservation to
  actual duration there (same `finalizeSpend` delta the inline path uses).
  Month-to-date: Run ids are ULIDs (time-ordered), so a key-condition range
  query over the current month suffices — no new accumulator, no reset cron.
  As built: the launcher stores the flat reservation on the Run as
  `reservedUsd`; when the task stops, `finalizeSandboxRun` prices the actual
  duration (`actualSandboxCost`, Fargate one-minute minimum) with the same
  env-injected task size the launcher used, applies the delta to the agent
  ledger via `finalizeSpend`, and shifts the run's accumulated `costUsd`
  (compute + metered LLM) by the same delta with an atomic `ADD`. The terminal
  patch nulls `reservedUsd` first, so a redelivered stop event (EventBridge is
  at-least-once) skips the delta instead of double-refunding; a crash between
  patch and delta leaves the conservative flat charge in place. Month-to-date
  needed no ULID boundary math: run sort keys embed the ISO `createdAt`
  (`RUN#<createdAt>#<runId>`), so `begins_with(sk, RUN#YYYY-MM-)` is the exact
  month range (`runRepo.sumMonthCost`). Exposed as `GET /agents/{id}/spend`,
  a `spend (month)` row in `village agents show`, and a month-to-date line on
  the web agent page.
- **07** — smallest honest version: CLI `village logs --follow` and a web
  panel via `FilterLogEvents` on the run's log streams; persist real
  `sandbox.run.*` transitions on the Run record (the lifecycle Lambda already
  observes them) and render those instead of `RunTimeline.events.ts`'s
  interpolated fake timestamps; emit EMF for `runs.error` /
  `runs.spend_limit_exceeded` or delete the two inert alarms. As built:
  `GET /agents/{id}/runs/{runId}/logs` is an owner-scoped paginated
  `FilterLogEvents` passthrough (`runner.getRunLogs`) over the two per-run
  streams `sandbox/{app,egress-proxy}/<taskId>` derived from the run's
  `taskArn`; the log-group name is env-injected (`AV_SANDBOX_LOG_GROUP`), the
  route's Lambda gets `logs:FilterLogEvents` on that group only, and both
  `village logs <agentId> <runId> [--follow]` (polls by `startTime` until a
  terminal status) and the web `RunLogs` panel (infinite-query pagination,
  auto-refresh while `running`) consume it. Real events: `Run.events`
  (`RunEventSchema`, default `[]`) records observed transitions — the
  launcher writes `sandbox.run.launched` / `agent.run.spend_rejected` /
  `sandbox.run.launch_failed`, the lifecycle handler appends
  `task_started`/`task_stopped` (from the ECS event's own timestamps) plus
  `finalized` (skipped on redelivery via the `finalized` marker), and the
  inline runner records its measured start/terminal pair — the web timeline
  renders only these; `RunTimeline.events.ts` is deleted and legacy runs get
  an honest empty state. EMF: `runOutcomeMetric(status)` (shared) merges an
  `_aws` envelope into the existing terminal-status structured logs — one
  datapoint per terminal run (`error`+`launch_failed` → `runs.error`;
  reserve-time rejections and finalized mid-run breaches →
  `runs.spend_limit_exceeded`; `timed_out` deliberately uncounted) — making
  both monitoring-stack alarms real.
- **08** — proves "zero platform changes": a plain Node script synced in via
  the workspace (deps vendored or `npm ci` with `registry.npmjs.org` in
  `egressAllow`), running on the static base image — so it does **not** need
  the still-unimplemented `manifest.image`. Grants: one `secret` (Gmail app
  password — the agent's own Gmail account, 2FA + app password; avoids the
  OAuth testing-mode 7-day refresh-token trap). Egress: `imap.gmail.com`,
  `smtp.gmail.com`, npm registry if not vendoring. Guards live in the app
  (sender allowlist, `Auto-Submitted` loop suppression) — application-level
  policy stays application-level. As built: one plain ESM script
  (`examples/gmail-agent/gmail-agent.mjs`; deps `imapflow`/`mailparser`/
  `nodemailer`/`@anthropic-ai/sdk` pinned by a committed
  `package-lock.json`), installed per run by the manifest `command` (`cp` to
  `/tmp` + `npm ci`, so `node_modules` never syncs to S3). Seen state is a
  UID watermark (`uidValidity` + `lastUid`) at
  `/workspace/gmail-agent/state.json`; the first run (or a `UIDVALIDITY`
  change) only baselines it — the backlog is never answered — and the
  watermark is persisted _before_ each send — at-most-once within a run; a
  hard kill or failed final workspace sync can replay a batch across runs,
  since the watermark only becomes durable at the entrypoint's S3 sync. The
  Anthropic SDK needed zero configuration beyond the platform-injected
  `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY`; the model defaults to
  `claude-opus-4-8` because the gateway rejects ids it cannot price. Grants:
  three generic `secret` grants — the app password plus `gmail-address` and
  `gmail-allowed-senders`, since the manifest has no plain-env field
  (non-secret config rides the secret mechanism; noted as a platform gap).
  Zero platform changes were required.
- **09** — the spend-breach test is the phase's acceptance test in miniature:
  with a low `spendLimitUsd`, the gateway must start rejecting mid-run and the
  run record must show `spend_limit_exceeded`-adjacent status with actual
  cost, not the flat estimate. As built, two tiers:
  - **AWS-free integration tier** (runs in `pnpm test`):
    `packages/services/src/sandbox-acceptance.test.ts` wires the REAL
    launcher → metering gateway → lifecycle handler over one faithful
    in-memory data layer (conditional reserve, atomic usage `ADD`s), faking
    only the AWS clients and the Anthropic upstream. Verified invariants: the
    token the launcher injects authenticates the gateway; the second call
    402s once `spendLimitUsd` is exhausted and marks the run
    `spend_limit_exceeded`; finalization preserves the breach and leaves
    `Run.costUsd` = actual compute + actual LLM usage = exactly what the
    ledger was charged (redelivered stop events change nothing); the
    watchdog schedule is armed at `timeoutMinutes + 2` with
    `AV_TIMEOUT_SECONDS` on the app container, tolerates the already-fired
    delete race, maps the watchdog's own stop reason (and exit 124) to
    `timed_out`, and kills the run's gateway token. The launcher↔entrypoint
    env-var name is lockstep-guarded in
    `packages/infra/test/entrypoint.test.ts`, and
    `packages/web/src/components/RunDetail.test.tsx` asserts the run viewer
    renders reconciled `costUsd` and never `reservedUsd`.
  - **Live-AWS tier** (opt-in): `packages/web/e2e/phase3-sandbox.spec.ts`
    drives the breach + hang scenarios through the real UI against a
    deployed environment; skipped unless `E2E_AWS=1` (fixture setup in
    `packages/web/e2e/README.md`). Not exercised in CI — run it manually
    after deploying.

## Post-implementation review (2026-07-08)

A multi-agent adversarial review of the full phase diff surfaced eight
confirmed defects, all fixed on this branch:

- **Metering token outlived a breached run (critical).** `spend_limit_exceeded`
  is both the mid-run breach signal the gateway honors and a _terminal_ status;
  `gatewayTokenHash` was never cleared, so a leaked per-run token kept
  authenticating forever after the task died — and the compute reconcile's
  negative delta freed budget it could then spend. Fix: `finalizeSandboxRun`
  and `onLaunchFailure` null `gatewayTokenHash`, so every terminal run's token
  dies (`authenticate()` rejects a hash-less run).
- **App container ran as root (critical).** The base image had no `USER`; a
  steered app could `setuid(1337)` (the proxy uid the egress redirect exempts)
  and bypass the allowlist. ADR 0003 _claimed_ this mitigation existed — now it
  does: base image runs as uid 10001 and the task definition pins `user`.
- **DNS port-53 tunnel (major).** The proxy exempted `--dport 53` for _any_
  host, a full bidirectional tunnel around the allowlist. Now pinned to the
  task's `/etc/resolv.conf` resolvers.
- **Start-order egress window (major).** App and proxy started in parallel, so
  the app could egress before iptables was installed. The proxy now has a
  health check (readiness marker written after the rules) and the app
  `dependsOn` it `HEALTHY`.
- **Fargate cost overstated ~20% (major).** The pricing constants were x86
  rates on an ARM64 task; corrected to Graviton rates.
- **Reconcile failure double-billed (major).** A DynamoDB throttle during
  post-call reconciliation surfaced as a 500, making the sandbox SDK retry an
  already-billed generation. Reconciliation is now isolated; the billed
  response is always returned (reservation kept — safe direction).
- **1-hour cache writes undercounted (major).** Metered at 1.25x but billed 2x
  by Anthropic. Now the `cache_creation.ephemeral_1h_input_tokens` bucket is
  priced at 2x.
- **Run-log panel polled forever (major).** Frozen `running` prop ignored the
  per-page `runStatus`; polling now self-terminates on a terminal status and
  the run query refetches while running.

Deferred as minor (documented, low-severity edge cases): CLI `--follow`
same-millisecond dedupe and late-ingested-event cursor lag; a narrow
launch-failure-vs-stop-event race that can momentarily show a negative
`costUsd`; and `markSpendExhausted` relabelling a just-finalized run (de-fanged
by the token-null fix — it can no longer re-activate a token).

After each step: `pnpm lint && pnpm typecheck && pnpm test` stays green, and
`pnpm --filter @agent-village/infra synth:dev` must succeed without AWS
credentials.
