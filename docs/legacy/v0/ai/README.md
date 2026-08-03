# docs/ai — the AI team's 1.0 working state

This directory is the **persistent working memory of the AI team driving the
agent-village 1.0 release**. It survives across sessions: an agent picking up
the work mid-flight reads here first to learn what 1.0 _is_, what has been
reconciled, where each milestone stands, and what has been signed off.

Humans are welcome to read (and Ben, the owner, sets the bar), but the
**audience is agents**. Write for the next agent: state facts, cite code paths,
record verdicts, don't hedge.

## What lives here

| File / kind                            | Holds                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [1.0-definition.md](1.0-definition.md) | The **binding** 1.0 scope: testable acceptance criteria, what's in, what's explicitly out. The contract.              |
| Branch-reconciliation notes            | The record of consolidating the outstanding `claude/*` fix branches into a single trunk (milestone M2).               |
| Per-milestone status docs              | One file per milestone (`m3-spend-controls.md`, …) tracking which acceptance criteria are met, in flight, or blocked. |
| Verdicts                               | Go / no-go sign-offs — especially the local-dogfood verdict (M6) and the dev-AWS live verdict (M7).                   |

Status docs and verdicts are created as each milestone opens; they are not all
present yet. Name them for their milestone so the set stays scannable.

## How this relates to the rest of the repo

- **[1.0-definition.md](1.0-definition.md) is downstream of, and defers to, the
  owner's bar.** It formalizes that bar into criteria; it does not add scope.
- Files here **may reference each other** and the milestone plan freely — this
  is working state, not the curated one-question-per-file
  [docs tree](../README.md).
- Load-bearing conclusions still graduate the usual way: into code, a test, an
  [ADR](../adr/README.md), a [phase plan](../phases/README.md), or a
  [playbook](../playbooks/README.md). `docs/ai/` is where the 1.0 push is
  _coordinated_, not where the durable architecture record ultimately lives.
- For direction and the north star, see the [roadmap](../roadmap.md); 1.0 is
  the concrete productionization slice of it.

## Conventions

- Relative links must resolve — the structural test
  `tests/structural/src/doc-links.test.ts` fails on dead relative links. When
  referencing a deliverable that does not exist yet (e.g. a not-yet-written
  playbook), write its path in backticks, not as a live Markdown link.
- Keep each file tight and scannable. Tables over prose where it fits.
- Every acceptance criterion has a stable ID (`AC-<item>.<n>`). Cite the ID, not
  a paraphrase, when reporting status.
