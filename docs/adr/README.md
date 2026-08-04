# Architecture Decision Records

An append-only log of decisions that were expensive to make and would be expensive to reverse.
Format: [adr.github.io](https://adr.github.io).

**Never edit an accepted ADR.** Write a new one that supersedes it. The single exception is the
`Status:` line of the superseded ADR, which is updated to point at its successor.

| ADR                                           | Title                         | Status   |
| --------------------------------------------- | ----------------------------- | -------- |
| [0001](0001-docs-first-spec-driven-reset.md)  | Docs-first, spec-driven reset | Accepted |
| [0002](0002-history-over-commentary.md)       | History over commentary       | Accepted |
| [0003](0003-auditability-is-a-requirement.md) | Auditability is a requirement | Accepted |
| [0004](0004-typescript-node-stack.md)         | TypeScript on Node stack      | Proposed |

## When to write one

Write an ADR when a choice constrains future work, is expensive to reverse, or would make a future
reader ask "why on earth is it like this?" — a runtime, a storage model, a trust boundary, a
protocol, a repo-wide rule. Do not write one for choices that are cheap to change.

If you find yourself defending a decision in a PR comment, that is the signal: the argument belongs
in an ADR where the next agent will find it.

## How to add one

1. Copy [TEMPLATE.md](TEMPLATE.md) to `NNNN-<kebab-slug>.md`, using the next free number.
2. Fill in Context, Decision, Consequences, Status. Be specific; name the alternatives you rejected
   and why.
3. Add a row to the table above.
4. If it supersedes an existing ADR, set that ADR's `Status:` to `Superseded by ADR-NNNN`.

Full guide: [../dev/workflows/write-an-adr.md](../dev/workflows/write-an-adr.md).
