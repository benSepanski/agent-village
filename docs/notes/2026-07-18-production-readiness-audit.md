# Production-readiness audit + fixes — 2026-07-18

Handoff after an adversarial multi-agent audit of the platform's guarantee
surfaces (spend cap, sandbox isolation, concurrency, API/auth, ops resilience),
run on the `claude/ultracode-production-ready-a27e50` branch as the "make the
library production-ready before re-implementing apply-bot on it" step. 14
findings survived verification (12 confirmed, 2 plausible). **7 fixed this
pass; the remaining 6 were deferred with concrete fix sketches below, then
closed in a follow-up pass (PR #25) — every finding tracked in this note is
now closed.**

## Fixed this pass (with regression tests)

- **[critical] Live-task launch-failure race** — `runner-sandbox.ts`
  `launchAndRecord`: a transient DynamoDB failure on the post-launch `taskArn`
  bookkeeping write routed a LIVE Fargate task into `onLaunchFailure`, freeing
  the one-run-per-agent slot while the task kept running → a second concurrent
  run could clobber the shared per-agent workspace (ADR-0002 break) + spend
  under-count. Fix: the `taskArn` patch is now best-effort (logged + swallowed
  via `sandbox.run.taskarn_persist_failed`), never treated as a launch failure.
- **[high] Negative `Run.costUsd` poison** — `onLaunchFailure` SET `costUsd=0`
  unconditionally before claiming the reservation; a concurrent
  `reconcileComputeSpend` ADD of a negative delta could land on the 0 and
  persist a negative cost, which violates `RunSchema.costUsd.nonnegative()` and
  **permanently 500s the agent's whole run-list read** (`listForAgent` parses
  every row). Fix: `costUsd=0` is written only when `onLaunchFailure` WINS the
  reservation claim, making it mutually exclusive with reconcile's ADD.
- **[med] S3 egress wildcard** — `sandbox-egress.ts` allowlisted
  `*.s3.<region>` + bare `s3.<region>` + global `s3.amazonaws.com`, i.e. ANY
  bucket → a compromised app could exfiltrate its injected third-party tokens to
  an attacker bucket, bypassing the manifest allowlist (IAM only scopes S3
  _actions_, not anonymous PUTs). Fix: scoped to the workspace bucket's
  virtual-hosted hostnames only.
- **[med] Inline reservation ignored input tokens** — `estimateCost` reserved
  output-only; a 20k-char system prompt (~$0.05 input on fable-5) could settle
  above the hard cap. Fix: `estimateCost` now takes `inputChars` and prices a
  worst-case input term; the inline runner passes prompt+message length.
- **[med] Gateway reservation ignored cache-write premiums** —
  `estimateGatewayCall` priced input at 1x; `actualCost` bills cache writes at
  up to 2x → cache-heavy calls (the apply-bot pattern) settled above the cap.
  Fix: reserve input at the 2x (1h cache-write) ceiling.
- **[med] No alarms on the lifecycle + gateway Lambdas** — only the runner
  Lambda was alarmed; a wedged finalizer or failing gateway was invisible. Fix:
  `MonitoringStack` now builds error + p95-duration alarms for both (wired in
  `bin/app.ts`).
- **[low] Malformed JSON → 500** — `middleware.errorResponse` now maps
  `SyntaxError` to 400.

## Deferred — all closed 2026-07-18 (second pass)

The six items below were closed in a follow-up pass (multi-agent implement +
adversarial review, then a hand-reconciled integration). `pnpm lint typecheck
test`, `format:check`, `deps:check`, and `synth:dev` are all green. Summary of
what shipped:

- **[med] DLQ + stuck-run sweeper** — SQS DLQ on the `SandboxTaskStopped` target
  (bounded retry: 10 attempts / 6 h) plus a `rate(5 min)` sweeper Lambda
  (`packages/runner/src/sweeper.ts` → `sweepStuckSandboxRuns` →
  `listStuckSandboxRuns`) that finalizes runs wedged in `running` past
  max-lifetime by **reusing** `finalizeSandboxRun` (idempotent via
  `claimRunReservation`, per-run try/catch). Threshold = 155 min (120 max
  timeout + 5 watchdog grace + 30 safety).
- **[med] Watchdog retry/DLQ/alarm** — scheduler `StopTask` target now
  `MaximumRetryAttempts: 10` + a watchdog DLQ (role `sqs:SendMessage` scoped to
  it); the false "StopTask can never succeed if already stopped" comment is
  corrected. New `MonitoringStack` alarms (`buildResilienceAlarms`): lifecycle-
  DLQ, watchdog-DLQ (`ApproximateNumberOfMessagesVisible > 0`), and
  sweeper-errors, all paging the existing alarm topic.
- **[low] EMF run-outcome double-count** — `reconcileComputeSpend` returns
  whether THIS invocation won the reservation claim; the finalized log gates
  `runOutcomeMetric` on that won-write signal instead of the pre-read snapshot,
  so a redelivered STOPPED event counts each outcome once.
- **[low] Deadline-abort refund asymmetry** — an in-flight abort
  (`isUpstreamAbort`) now retains the worst-case reservation and returns a
  non-retryable 499 (was full-refund + retryable 502), so a possibly-billed
  generation isn't paid twice; a genuine connection failure still refunds + 502.
- **[low] IPv6 egress fail-open** — `proxy-image/entrypoint.sh` adds
  `ip6tables -P OUTPUT DROP` (+ loopback / IPv6-DNS exemptions), guarded so a
  missing `ip6tables` still fails closed without crashing startup.
- **[low] Gateway timeout configurable** — `resolveUpstreamTimeoutMs` reads
  `AV_GATEWAY_UPSTREAM_TIMEOUT_MS` (default 290 s, clamped 30 s–15 min), wired
  onto the gateway Lambda from `GATEWAY_TIMEOUT_MINUTES` so that one constant
  stays the single knob for long apply-bot generations. The upstream-call
  concern moved to `packages/services/src/gateway-upstream.ts`; the runner IAM /
  DLQ / watchdog-role helpers moved to `packages/infra/src/stacks/runner-iam.ts`.

Original deferred sketches (kept for provenance):

- **[med] No DLQ / stuck-run reconciler** — the `SandboxTaskStopped` EventBridge
  rule (`runner-stack.ts`) has no DLQ, and there is no sweeper for runs stuck in
  `status='running'` past `timeoutMinutes`. A poison-pill or >24h outage in the
  lifecycle finalizer permanently wedges the agent's slot. Fix: DLQ on the rule
  target + a scheduled sweeper Lambda that finalizes overdue running runs. Note
  the finalizer already fails SAFE (blocks new runs, never overspends) and
  EventBridge async-retries ~24h, so this is availability, not a cap/isolation
  break.
- **[med] Watchdog kill-switch is un-retried / un-alarmed** —
  `sandbox-watchdog.ts` sets `MaximumRetryAttempts:0` with no DLQ; a transient
  ECS `StopTask` throttle at fire time silently drops the backstop (only bites
  under the compound failure where the in-container `timeout` ALSO failed). Fix:
  `MaximumRetryAttempts>0` + `DeadLetterConfig`, and alarm on watchdog-fire
  failures. (The comment claiming StopTask "can never succeed if already
  stopped" is also wrong — it returns success.)
- **[low] EMF run-outcome metric double-count** — `sandbox-lifecycle.ts` gates
  `runOutcomeMetric` on the start-of-handler `existing` snapshot, so concurrent
  at-least-once redelivery of a STOPPED event emits it twice (spend settles once
  via `claimRunReservation`; the metric has no equivalent won-write gate). Only
  inflates error/breach counters; alarms fire on `>0` so state doesn't flip.
  Fix: gate the emit on a value only the winning write sees.
- **[low, plausible] Deadline-abort refund asymmetry** —
  `anthropic-gateway.ts` fully refunds on the ~4m50s deadline abort even though
  Anthropic may have billed the generation server-side, and the 502 is
  SDK-retryable. Depends on unverifiable upstream billing behavior. Fix: on
  abort, retain the reservation and/or return a non-retryable status.
- **[low, latent] IPv6 egress fail-open** — `proxy-image/entrypoint.sh` installs
  its iptables egress rules IPv4-only. Not exploitable today (the sandbox VPC is
  IPv4-only) but fragile: adding a dual-stack CIDR would open all IPv6 egress.
  Fix: add `ip6tables -P OUTPUT DROP` (+ loopback/DNS) so it fails closed
  regardless of VPC config.
- **[low] Gateway 5-min hard timeout not configurable** — fine today; may need
  raising for long apply-bot web-search generations.

## Where the audit lives

Full verifier reasoning per finding is in the workflow result the audit
produced (not committed). This note is the durable summary — prune it once the
deferred items land in a phase doc.
