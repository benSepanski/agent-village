# Phase 1 — MVP (done)

**Goal:** end-to-end vertical slice. User signs in (email or Google), creates an agent (name + API key + spend limit + cron), the agent runs on schedule (or Run-now from the UI), the run is logged, and the UI shows the run with a per-step timeline.

All 14 steps below are delivered. Known deviations from this spec as shipped:

- **Google federation is not wired** — the Cognito client supports only the `COGNITO` identity provider; email/password is the working sign-in (see [key-properties/user-auth](../key-properties/user-auth.md)).
- **The prompt scratchpad's standalone "Run" has no backend** — "Save to agent" works; one-off scratchpad runs do not execute.
- **The `metric` log payloads are not EMF-formatted**, so the custom-namespace alarms are inert (see [observability](../architecture/observability.md#metrics)).

## Scope

In:

- Cognito auth (email + Google federation).
- Agent CRUD via HTTP API.
- EventBridge Scheduler per agent.
- Runner Lambda calling Anthropic with atomic spend reservation.
- Web UI: agent list, agent detail with run history, run detail with timeline, scratchpad, Run-now/Replay/Dry-run controls.
- CLI: `village agents list|show`, `village run`, `village logs`, `village env doctor`.
- Alarms: runner error rate, spend-limit-exceeded.

Out (deferred):

- Per-user notification routing (Phase 2).
- Built-in Anthropic tools — `web_search`, `code_execution` (Phase 3).
- Outbound tools — agent email, GitHub PR (Phases 4–6).
- Multi-user / admin / viewer roles (Phase 7).
- Retention policy + audit summarizer (Phase 8).

## Work breakdown

Execute in order. Each link is a self-contained ~1-screen brief.

| #   | Step                                                          | Touches             |
| --- | ------------------------------------------------------------- | ------------------- |
| 1   | [Schemas](phase-1/01-schemas.md)                              | `packages/shared`   |
| 2   | [Data repositories](phase-1/02-data-repos.md)                 | `packages/data`     |
| 3   | [Secrets adapter](phase-1/03-secrets.md)                      | `packages/data`     |
| 4   | [Domain helpers](phase-1/04-domain.md)                        | `packages/domain`   |
| 5   | [Services (use cases)](phase-1/05-services.md)                | `packages/services` |
| 6   | [Infra wiring](phase-1/06-infra.md)                           | `packages/infra`    |
| 7   | [API handlers](phase-1/07-api-handlers.md)                    | `packages/api`      |
| 8   | [Runner handler](phase-1/08-runner.md)                        | `packages/runner`   |
| 9   | [CLI](phase-1/09-cli.md)                                      | `packages/cli`      |
| 10  | [Web — auth](phase-1/10-web-auth.md)                          | `packages/web`      |
| 11  | [Web — agent UI](phase-1/11-web-agent-ui.md)                  | `packages/web`      |
| 12  | [Web — run viewer + scratchpad](phase-1/12-web-run-viewer.md) | `packages/web`      |
| 13  | [Alarms](phase-1/13-alarms.md)                                | `packages/infra`    |
| 14  | [E2E test](phase-1/14-e2e.md)                                 | `packages/web/e2e`  |

## Dependencies between steps

```
1 (schemas) ────┬──▶ 2 (repos) ──┐
                ├──▶ 3 (secrets) ─┤
                └──▶ 4 (domain) ──┘
                                  ▼
                              5 (services)
                                  │
              ┌───────────────────┼────────────────────┐
              ▼                   ▼                    ▼
        7 (api)             8 (runner)             9 (cli)
              │                   │
              └───────────┬───────┘
                          ▼
                      6 (infra) ──▶ 13 (alarms)
                          │
                          ▼
              10 → 11 → 12 (web)
                          │
                          ▼
                      14 (e2e)
```

Steps 7, 8, 9 can be done in parallel. Web steps depend on infra deploys for real Cognito URLs.

## Definition of done

- Sign in with email; sign in with Google — both produce a User row.
- Create an agent with `*/5 * * * *` schedule. Wait 5 min, observe a Run row in the UI with non-zero cost.
- Click "Run now" on the agent — Run appears with status `ok` and a populated timeline.
- Click "Replay" — second Run with the same prompt + config.
- Set `spendUsedUsd` near limit — next run records `spend_limit_exceeded` with no Anthropic call.
- `pnpm village run <agentId>` produces the same result as the UI button.
- All gates pass: `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm e2e`.
- Dev environment idle cost over a week < $1.

## When something doesn't fit

If a step bumps into the hard lint bounds (file >300 lines, complexity >10, etc.), the fix is to extract — never suppress. If the design itself needs to change, that's an ADR. See [permissions/ask-first.md](../permissions/ask-first.md).
