# Phase 4+ roadmap

Sketches only — the phase-level slice of the [roadmap](../roadmap.md). Each
phase gets its own detailed breakdown when it's next. Phase 2 (sandboxed
application runs) is detailed in [phase-2-sandbox-runs](phase-2-sandbox-runs.md);
its tool-grant model (`ApplicationManifest.grants`) absorbs what were previously
the outbound-email, read-only-MCP, and GitHub phases — those now ship as grant
kinds + the egress proxy rather than standalone phases. Phase 3 (platform
capabilities so one-off manifest applications are self-serve, with a Gmail-agent
reference app) is **delivered** — see
[phase-3-application-platform](phase-3-application-platform.md) — and absorbed
the sandbox-hardening items (kill switch, metered LLM spend, proxy port
preservation, generic secret grants, honest cost/observability).

The immediate next work is not a numbered phase but a concrete app:
**apply-bot as a manifest app** (see the
[roadmap](../roadmap.md#next-concrete-goal--apply-bot-as-a-manifest-app)). It
mainly needs the "per-manifest task definitions / `manifest.image`" item below
(a Python runtime) plus plain manifest env; both are already on this list.

| Phase | Theme             | Headline deliverable                                                                                                                                           |
| ----- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4     | Notifications     | Per-user notification routing (email + future Slack); pause-on-failure policy                                                                                  |
| 5     | Built-in tools    | Anthropic `web_search`, `code_execution` for inline (non-sandbox) agents                                                                                       |
| 6     | More grant kinds  | Gmail / Calendar read-only via per-agent OAuth, as `ApplicationManifest` grants                                                                                |
| 7     | Multi-user        | Admin / viewer roles per agent; org-scoped Cognito groups                                                                                                      |
| 8     | Retention + audit | Retention policies + an audit-summarizer agent over old runs                                                                                                   |
| 9+    | Daemon apps       | Hosting always-on agent daemons (e.g. OpenClaw): service-mode runtime instead of scheduled tasks, per-manifest task definitions so `manifest.image` is honored |

Smaller backlog items surfaced by Phase 3, slotted into whichever phase touches
them first:

- **Plain (non-secret) manifest env** — manifests can only deliver
  configuration via `secret` grants, so non-sensitive settings (an email
  address, a sender allowlist, a model id) must be provisioned as Secrets
  Manager secrets by hand and consume the grant cap; a `manifest.env` map of
  validated plain values would remove that friction (found by the Gmail
  reference app, step 08).
- **CLI/API to store agent secrets** — `storeAgentSecret` exists in the data
  layer but no user-facing command wires it; all grant secrets (typed and
  generic) are provisioned out-of-band with the AWS CLI today.
- **Gateway model pricing table** — the metering gateway 400s model ids it
  cannot price; keeping the priced set current is a recurring chore (last
  refreshed 2026-07: Fable 5 / Opus 4.8 / Sonnet 5 / Haiku 4.5 added, Opus 4.7
  and Haiku prices corrected to public list).

Deferred from the Phase 3 review (2026-07-08), low severity — details in the
[phase 3 doc](phase-3-application-platform.md#post-implementation-review-2026-07-08):

- **CLI `--follow` log fidelity** — drops genuinely-duplicate log lines emitted
  in the same millisecond, and can miss a late-ingested event whose timestamp is
  at or behind the follow cursor. A one-shot `village logs` (startTime 0) still
  shows them.
- **Launch-failure vs stop-event race** — a task whose watchdog-arming failed
  can have `onLaunchFailure` interleave with the concurrent STOPPED event and
  momentarily show a negative `Run.costUsd`. Money is safe (the reservation is
  claimed by exactly one path); only the run-record cost display drifts.

Each phase reuses the harness from Phase 0. No new top-level concerns unless an [ADR](../adr/README.md) justifies it.
