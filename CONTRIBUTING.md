# Contributing

These are the working guides for this repository — for people and for agents. Agents should also
read [AGENTS.md](AGENTS.md), which is the shorter map.

## The two loops

Work here is either **finding out what to build** (outer loop) or **building it** (inner loop).

### Outer loop — reaching a design spec

A design spec is the design target. It states goals, terminology, user flows, architecture,
guarantees, edge cases, non-goals, and scoping guidance, and it is precise enough that reasonable
people would build the same system from it.

1. **Discuss until it is real.** Specs are produced by iteration with the owner, not written in one
   pass. Disagreement, unknowns, and "we don't know yet" belong in the spec's Open Questions.
2. **Accept it.** Only the owner accepts a spec. Acceptance makes its terminology and guarantees
   binding on the code.
3. **Build it** via the inner loop.
4. **Close it out.** A spec ends as `Completed`, or as `Abandoned` when it turns out to be nonviable
   or to carry issues large enough that continuing is wrong. Both endings are successes if they are
   honest and documented.
5. **Ask for the next spec.** Report the outcome and hand the decision about what is next to the
   owner.

Guide: [docs/dev/workflows/author-a-spec.md](docs/dev/workflows/author-a-spec.md).

### Inner loop — building an Accepted spec

| Step                       | Guide                                                                        |
| -------------------------- | ---------------------------------------------------------------------------- |
| Break the spec into slices | [decompose-into-milestones](docs/dev/workflows/decompose-into-milestones.md) |
| Build one slice            | [execute-a-milestone](docs/dev/workflows/execute-a-milestone.md)             |
| Check that slice           | [qa-a-milestone](docs/dev/workflows/qa-a-milestone.md)                       |
| Check the spec as a whole  | [qa-a-spec](docs/dev/workflows/qa-a-spec.md)                                 |
| Close a spec out           | [archive-a-spec](docs/dev/workflows/archive-a-spec.md)                       |

## Writing

Where a given piece of writing belongs is a mechanical question with a mechanical answer:
[docs/dev/doc-system.md](docs/dev/doc-system.md). The short version — a doc answers one question on
one screen; if it answers two, split it; if it restates what code or a schema already says, delete
it and link instead.

## Decisions

Any decision that is expensive to reverse, constrains future work, or would make a reader ask "why
on earth is it like this?" gets an [ADR](docs/adr/). ADRs are append-only: supersede, never rewrite.
Guide: [write-an-adr](docs/dev/workflows/write-an-adr.md).

Decisions that are _not_ ADR-worthy — naming a variable, structuring one function — just get made.

## History and commit messages

Git is the record of how the code got here ([ADR-0002](docs/adr/0002-history-over-commentary.md)).
That places a real burden on commits:

- **Conventional commits**: `type(scope): summary`, e.g. `feat(bridge): deny egress by default`.
  Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`. `!` or a
  `BREAKING CHANGE:` footer for breaking changes.
- **The body explains why.** What changed is in the diff. Why it changed, what you rejected, and
  what you could not verify go in the body — that is now the only place they live.
- **Cite the driver**: the spec and criterion ID (`AC-M2.3`), the ADR number, or the QA finding.
- Do not delete code by commenting it out. Delete it; git remembers.

## Pull requests

A PR body says what changed, which spec/milestone criteria it satisfies, how it was verified, and
what was _not_ verified. Claiming verification you did not do is the one unrecoverable mistake —
an unverified honest PR is fine, a falsely confident one poisons every later decision.

## Definition of done

A unit of work is done when all of these hold:

1. Every acceptance criterion it claims is satisfied and cited by ID.
2. The audit surface it touches is described and actually emits
   ([ADR-0003](docs/adr/0003-auditability-is-a-requirement.md)).
3. Its QA doc exists under the spec's `qa/` directory with evidence, not assertions.
4. `pnpm check` passes, plus whatever checks the spec has since introduced.
5. Docs that the change invalidated are updated or deleted in the same change.

## Setup

```bash
pnpm install
pnpm check
```

Node 22 (see [.nvmrc](.nvmrc)). More in [docs/dev/README.md](docs/dev/README.md).
