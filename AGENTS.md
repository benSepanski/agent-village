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

## How the harness expects you to work

The harness — linters, schemas, dependency-cruiser, hooks, CI — is the primary way correctness is enforced. AGENTS.md and `docs/` exist to help you, but if the harness disagrees with prose, the harness wins. Operating rules:

- **Mechanism beats memory.** Quality is enforced by tools, not by remembering this file. **Never edit lint, type-check, dependency-cruiser, or CI config to silence a violation** — fix the code, or raise an ADR if the rule itself is wrong.
- **Tests and schemas are ground truth; prose rots.** Prefer adding a Zod schema, test, or ADR over a paragraph that re-describes the code.
- **Iterative disclosure.** Each doc answers one question on one screen — don't sprawl AGENTS.md. New knowledge goes in a new doc linked from [docs/README.md](docs/README.md).
- **Fast loops over slow ones.** Run `pnpm lint` / `pnpm typecheck` / `pnpm test` locally — don't push to find out CI says no.
- **Plan, then verify.** For non-trivial work, sketch the change before executing. Compiling is not "working" — run the relevant tests (and `pnpm e2e` for UI) before declaring it done, or say explicitly in the PR what you couldn't verify.
- **Single source of truth lives in the repo.** Facts that matter belong in code, schemas, tests, ADRs, or `docs/` — not in chat or memory.

Full discussion of these principles (read only if designing new harness pieces or debating a rule): [docs/conventions/harness-engineering.md](docs/conventions/harness-engineering.md).

## Commands you'll use

**First thing in a fresh worktree, always:** `pnpm install`. It pulls **all** dependencies — including the dev tools the git hooks invoke (`lint-staged`, `husky`, `eslint`, `prettier`, `dependency-cruiser`). Skip this and your first `git commit` fails with `Command "lint-staged" not found`. pnpm installs devDependencies by default; do **not** pass `--prod` or set `NODE_ENV=production` locally. The hooks also require Node ≥22 (see [`.nvmrc`](.nvmrc)) — `nvm use` or `mise use` before installing.

```bash
pnpm install                     # bootstrap — run this first; installs devDependencies (required for hooks)
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
