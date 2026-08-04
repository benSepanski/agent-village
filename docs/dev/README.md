# Developer notes

How to work the repository itself. For _what_ to work on, see [../specs/](../specs/); for _how work
flows_, see [../../CONTRIBUTING.md](../../CONTRIBUTING.md).

## Setup

```bash
nvm use        # Node 22, from .nvmrc
pnpm install
```

## Commands

| Command             | Does                                                     |
| ------------------- | -------------------------------------------------------- |
| `pnpm check`        | Everything CI runs. Run this before pushing.             |
| `pnpm format`       | Rewrite files to canonical formatting                    |
| `pnpm format:check` | Fail if formatting is off                                |
| `pnpm check:links`  | Fail if a relative Markdown link points nowhere          |
| `pnpm -r typecheck` | TypeScript strict mode over every package                |
| `pnpm -r lint`      | ESLint (typescript-eslint, type-checked) over `src/`     |
| `pnpm -r test`      | Build, then `node --test` over each package's unit tests |

Verification that needs a Docker daemon is not in `pnpm check`; each milestone documents its own
fixture command (e.g. `pnpm --filter @agent-village/agent-environment fixture:m1`). A new check
lands here and in `.github/workflows/docs.yml` in the same change — a check that is not in CI is a
suggestion.

## Layout

| Path           | Holds                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `docs/specs/`  | Design specs, their milestones, and their QA — the binding design target                          |
| `docs/adr/`    | Decisions and their reasoning, append-only                                                        |
| `docs/dev/`    | This: how to use and navigate the repo, plus workflow guides                                      |
| `docs/ai/`     | Scratch notes between sessions. Never load-bearing                                                |
| `docs/legacy/` | Frozen docs for systems that no longer exist                                                      |
| `packages/`    | Implementation, one pnpm package per component ([ADR-0004](../adr/0004-typescript-node-stack.md)) |
| `scripts/`     | The docs harness. Node, zero dependencies                                                         |

Deciding where a new document goes: [doc-system.md](doc-system.md).

## The harness

All mechanical, all in CI:

- **Prettier** over Markdown, JSON, YAML, `.mjs`, and `.ts`. Formatting arguments are a waste of a
  review.
- **[`scripts/check-doc-links.mjs`](../../scripts/check-doc-links.mjs)** — every relative Markdown
  link must resolve. This is what makes "link aggressively instead of repeating yourself" safe: a
  moved file fails loudly instead of leaving a dead pointer. `docs/legacy/` is excluded, since its
  links have rotted by design.
- **TypeScript strict** and **typescript-eslint (type-checked)** over every package — unused code,
  floating promises, and boundary types are errors, not review comments
  ([ADR-0004](../adr/0004-typescript-node-stack.md)).
- **`node --test`** unit tests per package. Tests needing a Docker daemon live in milestone fixture
  commands instead, so `pnpm check` stays runnable anywhere.

Rules for the harness itself, from [design-principles.md](design-principles.md): checks are errors
rather than warnings, and you never weaken a check to make it pass — fix the work, or argue the rule
in an ADR.

## Conventions that are not yet mechanical

These are review rules; [ADR-0004](../adr/0004-typescript-node-stack.md) records why no lint rule
enforces them yet:

- No commented-out code, no change-narrating comments
  ([ADR-0002](../adr/0002-history-over-commentary.md)).
- Every component states its audit surface
  ([ADR-0003](../adr/0003-auditability-is-a-requirement.md)).
- One doc, one question ([doc-system.md](doc-system.md)).
