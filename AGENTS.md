# AGENTS.md — Agent Village

This file is a **map**, not an encyclopedia. The system of record lives in `docs/`.

## What this repo is

Agent Village is a personal AWS-hosted scheduler for autonomous AI agents.
Users sign in, configure agents (Anthropic key, spend limit, cron, scoped tools), and
the system runs them and shows results in a web UI.

## Where to find things

| You want to know about                        | Read                                                               |
| --------------------------------------------- | ------------------------------------------------------------------ |
| System layout, runtime topology               | [docs/architecture.md](docs/architecture.md)                       |
| Coding conventions (logging, errors, schemas) | [docs/conventions.md](docs/conventions.md)                         |
| DynamoDB single-table design + entity shapes  | [docs/data-model.md](docs/data-model.md)                           |
| What you may / must ask about / must never do | [docs/permissions.md](docs/permissions.md)                         |
| "How do I add an X?" recipes                  | [docs/playbooks/](docs/playbooks/)                                 |
| Past decisions and the reasoning behind them  | [docs/adr/](docs/adr/)                                             |
| Plan for the current build phase              | `/Users/bmsepan/.claude/plans/hello-let-s-work-iridescent-tome.md` |

## Repo layout (one-liner)

`packages/{shared,domain,data,services,api,runner,web,cli,infra}` with **enforced** dependency
edges: `shared ← domain ← data ← services ← {api, runner, cli}`; `web ← shared`; `infra ← shared`.
Run `pnpm deps:check` to verify.

## The three-tier rule (full text in [docs/permissions.md](docs/permissions.md))

- **Always (do without asking):** read any file, run `pnpm lint|typecheck|test|build|synth|deps:check`,
  add a new file inside a single package, write a unit test, update structured-log event names in
  `packages/shared/src/observability/events.ts` and use them.
- **Ask first:** add a new top-level package, weaken a lint rule, change the dependency graph,
  add a new AWS service/resource, change a CDK construct's `removalPolicy`, modify CI/CD or
  GitHub Actions, change Cognito password/MFA settings, change `monthlyBudgetUsd`.
- **Never:** disable lint inline, commit secrets or API keys, `git push --force` to `main`,
  edit `.husky/`, edit the contents of an existing ADR (write a new one instead), call AWS
  prod from a local script, exfiltrate user data outside the deployed system.

## Core commands

```bash
pnpm install            # bootstrap
pnpm local:up           # docker compose up + bootstrap LocalStack
pnpm doctor:local       # green-status table of local stack
pnpm dev                # turbo runs every package's dev target
pnpm lint               # all hard bounds + custom rules
pnpm typecheck          # tsc across the workspace
pnpm test               # vitest across the workspace
pnpm e2e                # playwright (boots web automatically)
pnpm --filter @agent-village/infra synth -- --context env=dev
```

## Hard bounds (lint errors, never warnings)

Complexity ≤ 10 · max depth 4 · function ≤ 50 lines · file ≤ 300 lines · params ≤ 4 · statements ≤ 15.
Inline `eslint-disable` is forbidden. Free-form `logger.info("...")` is forbidden — pass
`{ event: "<closed-enum>", ...payload }`.

If a rule fires, the message tells you the fix. Read the message before suppressing.
