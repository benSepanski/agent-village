# Phases

| Phase                   | Status    | Goal                                                                          |
| ----------------------- | --------- | ----------------------------------------------------------------------------- |
| [0](phase-0-harness.md) | ✅ done   | Harness only — no product code. Lint, layers, tests, CI/CD, docs, CDK stacks. |
| [1](phase-1-mvp.md)     | 🔨 next   | MVP — auth + Agent CRUD + scheduled Anthropic call + Run viewer.              |
| [2+](phase-2-plus.md)   | 📋 sketch | Notifications, tools, multi-user, audit summarizer.                           |

## Working on a phase

1. Read the phase doc top-to-bottom once.
2. Open the per-step detail directory (e.g. `phase-1/`) and execute steps in order.
3. After each step: `pnpm lint && pnpm typecheck && pnpm test` must stay green.
4. Each step's doc lists its acceptance criteria.
