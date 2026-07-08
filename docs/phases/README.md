# Phases

This directory is the **execution-plan home**: ordered, step-by-step plans with
acceptance criteria. For future direction and goals (the "what next / why") see
the [roadmap](../roadmap.md); for informal agent working notes see
[`notes/`](../notes/README.md).

| Phase                                | Status     | Goal                                                                               |
| ------------------------------------ | ---------- | ---------------------------------------------------------------------------------- |
| [0](phase-0-harness.md)              | ✅ done    | Harness only — no product code. Lint, layers, tests, CI/CD, docs, CDK stacks.      |
| [1](phase-1-mvp.md)                  | ✅ done    | MVP — auth + Agent CRUD + scheduled Anthropic call + Run viewer.                   |
| [2](phase-2-sandbox-runs.md)         | ✅ done    | Sandboxed application runs — Fargate + S3 workspaces + egress + grants.            |
| [3](phase-3-application-platform.md) | ✅ done    | One-off apps, safely — metered LLM spend, kill switch, proxy ports, secret grants. |
| [4](phase-4-apply-bot-enablement.md) | 📋 planned | apply-bot enablement — `manifest.env`, agent-secrets CLI/API, `manifest.image`.    |
| [5+](phase-2-plus.md)                | 📋 sketch  | Notifications, more tools, multi-user, audit summarizer, daemon apps.              |

## Working on a phase

1. Read the phase doc top-to-bottom once.
2. Open the per-step detail directory (e.g. `phase-1/`) and execute steps in order.
3. After each step: `pnpm lint && pnpm typecheck && pnpm test` must stay green.
4. Each step's doc lists its acceptance criteria.
