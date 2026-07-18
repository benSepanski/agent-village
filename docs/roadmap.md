# Roadmap

Forward-looking direction for agent-village. This is the **durable "where we're
going" home** — the north star plus the concrete next goals. It is deliberately
speculative; nothing here is a guarantee, and anything load-bearing that lands
gets promoted into code, a test, an [ADR](adr/README.md), or a phase doc.

Three homes, three jobs — don't mix them:

| Home                                                      | Holds                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------- |
| **this file** + [phase 6+ sketch](phases/phase-2-plus.md) | direction and future goals — the "why/what next"                  |
| [`phases/`](phases/README.md)                             | execution plans — ordered, step-by-step, with acceptance criteria |
| [`notes/`](notes/README.md)                               | generic agent working notes / session handoffs — informal, dated  |

## North star

A **personal platform** that runs one-off autonomous agent apps on a schedule,
safely and cheaply, with a hard spend cap and honest observability. App-level
features (a specific inbox, a specific workflow) stay **out** of the platform;
the platform ships general capabilities and reference apps prove them. See the
Gmail reference app ([`examples/gmail-agent`](../examples/gmail-agent/)) as the
model for "an app is a manifest + a synced workspace, zero platform changes."

## Where we are

| Phase                                                                      | State                             |
| -------------------------------------------------------------------------- | --------------------------------- |
| [0 — harness](phases/phase-0-harness.md)                                   | ✅ done                           |
| [1 — MVP](phases/phase-1-mvp.md)                                           | ✅ done                           |
| [2 — sandboxed application runs](phases/phase-2-sandbox-runs.md)           | ✅ done                           |
| [3 — one-off applications, safely](phases/phase-3-application-platform.md) | ✅ done (incl. post-review fixes) |
| [4 — apply-bot enablement](phases/phase-4-apply-bot-enablement.md)         | ✅ done                           |
| [5 — external app DX](phases/phase-5-app-dx.md)                            | 🚧 in progress                    |
| [6+ — sketch](phases/phase-2-plus.md)                                      | 📋 sketched                       |

## Next concrete goal — apply-bot as a manifest app

The driving goal behind Phase 2–3 is to run **apply-bot** (a Python job-search /
cover-letter agent, a sibling repo at `~/src/apply-bot`) on this platform as a
one-off manifest app — the same shape as `examples/gmail-agent`, no platform
forks. The platform prerequisites landed as
[Phase 4 — apply-bot enablement](phases/phase-4-apply-bot-enablement.md)
(**delivered**), and [Phase 5 — external app DX](phases/phase-5-app-dx.md)
makes the whole lifecycle drivable from the apply-bot repo itself (CLI login,
agent CRUD, workspace push — no AWS credentials). The original blockers, all
closed:

- **Python runtime in the sandbox.** ✅ The base image is Node
  ([`sandbox-image/Dockerfile`](../packages/infra/sandbox-image/Dockerfile));
  Phase 4 step 03 honors `manifest.image` (a tag in the base ECR repo) via
  per-image task definitions, and
  [`examples/python-sandbox-image`](../examples/python-sandbox-image/) is the
  build-and-push recipe for the Python image apply-bot needs.
- **Web-search egress.** apply-bot searches job boards; its manifest needs the
  right `egressAllow` domains (e.g. the search backend it uses), reachable now
  that the proxy preserves ports and the metering gateway fronts Anthropic.
- **Non-secret manifest config.** apply-bot takes a résumé/profile and target
  roles; today non-sensitive config can only ride `secret` grants. Phase 4
  step 01 adds the `manifest.env` map for plain config.
- **Session persistence.** apply-bot keeps a JSON session file across runs — a
  natural fit for the durable `/workspace`, like gmail-agent's seen-state
  watermark. Mind the at-most-once-per-run / replay-across-runs semantics the
  Gmail app documents.
- **Metered LLM.** apply-bot's Anthropic SDK honors `ANTHROPIC_BASE_URL` /
  `ANTHROPIC_API_KEY`, so it inherits the platform spend cap with no code change
  — same as gmail-agent.

## Backlog (unscheduled; slot into whichever phase touches it first)

Carried from the [phase 6+ sketch](phases/phase-2-plus.md) (plain manifest env,
the agent-secrets CLI/API, and per-manifest images graduated into
[Phase 4](phases/phase-4-apply-bot-enablement.md)):

- **Gateway model pricing table** — keep the priced model set current.
- **Per-manifest cpu/memory sizing** — Phase 4 keeps every task at the base
  size so the single-size cost model holds; daemon-scale apps will want more.

Deferred from the Phase 3 review (2026-07-08), low severity, documented in the
[phase 3 doc](phases/phase-3-application-platform.md#post-implementation-review-2026-07-08):

- CLI `--follow` drops same-millisecond duplicate log lines and can miss a
  late-ingested event whose timestamp is at/behind the cursor.
- ~~A narrow launch-failure-vs-stop-event race can momentarily show a negative
  `Run.costUsd`.~~ **Fixed 2026-07-18** — the audit below found this was not
  cosmetic: a negative `costUsd` violates `RunSchema.nonnegative()` and
  permanently 500s the agent's run-list read. `onLaunchFailure` now zeroes
  `costUsd` only when it wins the reservation claim.

Deferred from the production-readiness audit (2026-07-18) — **all six closed in a
2026-07-18 second pass** (details in
[notes](notes/2026-07-18-production-readiness-audit.md)):

- ~~**[med] No DLQ / stuck-run reconciler**~~ — DLQ on the `SandboxTaskStopped`
  target + a `rate(5 min)` sweeper Lambda that finalizes overdue `running` runs
  through the existing (idempotent) `finalizeSandboxRun` path.
- ~~**[med] Watchdog kill-switch un-retried / un-alarmed**~~ — scheduler
  `StopTask` now `MaximumRetryAttempts: 10` + a watchdog DLQ + DLQ/sweeper
  alarms; the false already-stopped comment is corrected.
- ~~**[low] EMF run-outcome metric double-counts**~~ — the outcome metric is
  gated on the won reservation claim (single-fire), not the pre-read snapshot.
- ~~**[low] Deadline-abort refund**~~ — an in-flight abort retains the
  reservation and returns a non-retryable 499 instead of refund + retryable 502.
- ~~**[low] IPv6 egress fail-open**~~ — `ip6tables -P OUTPUT DROP` (+ loopback /
  DNS), guarded so a missing `ip6tables` still fails closed.
- ~~**[low] Gateway 5-min hard timeout not configurable**~~ —
  `AV_GATEWAY_UPSTREAM_TIMEOUT_MS` (default 290 s, clamped), driven off the
  single `GATEWAY_TIMEOUT_MINUTES` knob.

With these closed, the platform's guarantee surfaces (spend cap, sandbox
isolation, concurrency, ops resilience) are production-ready.
[Phase 4](phases/phase-4-apply-bot-enablement.md) enablement and
[Phase 5](phases/phase-5-app-dx.md) external-app DX (CLI login/CRUD/workspace,
installable CLI, scaffold, [app guide](app-development.md)) make the platform
consumable from separate app repos; **re-implementing apply-bot in its own
repo on the platform is the next step**.

## Doc scaffolding (established 2026-07-08)

This repo now has explicit homes for forward-looking material so agents don't
have to choose between "cram it in a commit message" and "leave it out":
**roadmaps** here, **execution plans** in [`phases/`](phases/README.md), and
**generic agent working notes** in [`notes/`](notes/README.md). Keeping these
current is part of finishing a chunk of work, not an afterthought.
