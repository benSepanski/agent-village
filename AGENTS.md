# AGENTS.md

This file is the **map**. It is short on purpose — every detail lives in a linked doc that answers
one question. Read this, then jump.

## Where the project is right now

**Design phase.** The previous implementation was scrapped and archived under
[docs/legacy/v0/](docs/legacy/v0/), and no code has landed since. What we intend to build is
sketched in [README.md](README.md); what we have actually committed to lives in
[docs/specs/](docs/specs/).

**No code lands without an Accepted spec.** If you are asked to implement something and no spec
covers it, the correct move is to say so and work on the spec instead.

## How work happens

### Outer loop — specs

1. The owner and an agent iterate on a design spec until it is precise enough to build against.
2. The spec is Accepted. It is now the design target: terminology, guarantees, and non-goals in it
   are binding.
3. The spec is built via the inner loop, and is either completed, or found nonviable / to have
   unanticipated issues.
4. Either way, the agent **reports the outcome and asks the owner for the next spec.** Agents do not
   invent the next spec unilaterally.

Between those steps, QA is the default activity: QA a milestone, QA a spec, or improve the docs.

### Inner loop — building an Accepted spec

Decompose into milestones → execute a milestone → QA that milestone → QA the whole spec against its
criteria → next milestone, or exit to the outer loop.

Guides for every step: [docs/dev/workflows/](docs/dev/workflows/).

## Non-negotiables

| Rule                                                                                                                          | Detail                                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **VCS records history — comments and docs do not.** No commented-out code, no changelogs in source, no "changed X on <date>". | [ADR-0002](docs/adr/0002-history-over-commentary.md)       |
| **Auditability is a requirement of every component**, not a later feature.                                                    | [ADR-0003](docs/adr/0003-auditability-is-a-requirement.md) |
| **Every large or cross-cutting decision gets an ADR** before it is treated as settled.                                        | [write-an-adr](docs/dev/workflows/write-an-adr.md)         |
| **One doc answers one question, on one screen.** New knowledge is a new doc, linked from the router.                          | [doc-system](docs/dev/doc-system.md)                       |
| **The harness wins over prose.** Never weaken a check to make it pass; fix the work or raise an ADR.                          | [design-principles](docs/dev/design-principles.md)         |
| **Facts live in the repo**, not in chat or memory. If it matters, write it where it belongs.                                  | [doc-system](docs/dev/doc-system.md)                       |

## Where to go

| You want to                                         | Go to                                                                                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Find the doc for any question                       | [docs/README.md](docs/README.md)                                                                                              |
| Write or revise a design spec                       | [docs/dev/workflows/author-a-spec.md](docs/dev/workflows/author-a-spec.md)                                                    |
| Break an Accepted spec into milestones              | [docs/dev/workflows/decompose-into-milestones.md](docs/dev/workflows/decompose-into-milestones.md)                            |
| Build a milestone                                   | [docs/dev/workflows/execute-a-milestone.md](docs/dev/workflows/execute-a-milestone.md)                                        |
| QA a milestone or a spec                            | [docs/dev/workflows/qa-a-milestone.md](docs/dev/workflows/qa-a-milestone.md), [qa-a-spec.md](docs/dev/workflows/qa-a-spec.md) |
| Record a decision                                   | [docs/adr/](docs/adr/)                                                                                                        |
| Know what "AI-native / modular / simple" means here | [docs/dev/design-principles.md](docs/dev/design-principles.md)                                                                |
| Know where a piece of writing belongs               | [docs/dev/doc-system.md](docs/dev/doc-system.md)                                                                              |
| Leave scratch notes for the next session            | [docs/ai/](docs/ai/)                                                                                                          |
| Run the checks                                      | [docs/dev/README.md](docs/dev/README.md)                                                                                      |

## Commands

```bash
pnpm install   # once per fresh worktree
pnpm check     # format check + relative-link check — the whole harness today
pnpm format    # fix formatting
```

There is no build, test suite, or deploy yet — the first spec has not been built. When one
introduces them, they are documented in [docs/dev/README.md](docs/dev/README.md) and enforced in CI.
