# AGENTS.md

This file is the **map**. Detailed docs live in [`docs/`](docs/) — each one answers a single question.

## What this repo is

Agent Village: personal AWS-hosted scheduler for autonomous AI agents. Users sign in, configure agents (Anthropic key, spend limit, schedule, scoped tools), the system runs them, and the UI shows the results.

## Where to go

| You want to                                        | Go to                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Find the right doc for any question                | [docs/README.md](docs/README.md)                                               |
| Understand the runtime topology                    | [docs/architecture/topology.md](docs/architecture/topology.md)                 |
| See what's allowed to import from what             | [docs/architecture/layered-packages.md](docs/architecture/layered-packages.md) |
| Know what you may / must ask about / must never do | [docs/permissions/](docs/permissions/)                                         |
| Add a Lambda / route / etc.                        | [docs/playbooks/](docs/playbooks/)                                             |
| See past architectural decisions                   | [docs/adr/](docs/adr/)                                                         |
| Pick up the next phase of work                     | [docs/phases/](docs/phases/)                                                   |

## The shape of the project (one screen)

- **9 packages** under `packages/`, layered: `shared ← domain ← data ← services ← {api, runner, cli}`; `web ← shared`; `infra ← shared`.
- **Dependency graph is mechanically enforced** by `dependency-cruiser`. Cross-edges fail CI.
- **Lint hard bounds are errors, never warnings**: complexity ≤10, function ≤50 lines, file ≤300 lines, params ≤4, statements ≤15, max-depth 4.
- **Structured logs only**: `logger.x({ event: '<closed-enum>', ...payload })`. Free-form strings are blocked by lint.
- **Schemas at every trust boundary**: Lambda handlers must `.parse(...)` input through a Zod schema.

## Commands you'll use

```bash
pnpm install                     # bootstrap
pnpm local:up                    # docker compose + LocalStack + DynamoDB Local
pnpm doctor:local                # green/red status table
pnpm dev                         # all packages in dev mode
pnpm lint                        # everything
pnpm typecheck                   # everything
pnpm test                        # everything
pnpm e2e                         # playwright
pnpm --filter @agent-village/infra synth:dev
```

## Three-tier permissions (summary)

- **Always** — see [docs/permissions/always.md](docs/permissions/always.md).
- **Ask first** — see [docs/permissions/ask-first.md](docs/permissions/ask-first.md).
- **Never** — see [docs/permissions/never.md](docs/permissions/never.md).

When in doubt, treat it as **Ask first**.
