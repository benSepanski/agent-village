# Spec 0002 decomposed into milestones M1–M9

2026-08-03. Autonomous routine run, after acceptance earlier the same day.

Repo state at this run: no open PRs; spec 0002 `Accepted`; no milestones existed. Per the routing
table that means decompose. Wrote
[milestones/](../specs/0002-agent-environment/milestones/README.md) — M1–M9, every spec acceptance
criterion mapped in the index's coverage table. Also fixed the specs index, which still said
`Draft` after acceptance (#41 missed it), and deleted the acted-on acceptance-ask note per its own
instruction.

No notification sent this run: nothing needs the owner now. Next runs execute milestones starting
at M1 ([execute-a-milestone](../dev/workflows/execute-a-milestone.md)). M1 requires a language /
stack ADR before code — see its Decisions needed.

Unresolved, carried from the deleted note:

- **Branch protection**: the routine prompt says `main` requires an approving review and a check
  named `lint_typecheck_test_synth`, but PRs #39–#41 squash-merged via the API with green
  `format_and_links` only. Owner should verify the ruleset on `main` does what they intend.
  Recorded in #40; no notification has been sent about it; if still unaddressed and it starts
  blocking or admitting merges wrongly, one reminder is warranted (none sent before 2026-08-10).
- Spec 0002's open questions include two owner rulings (`model.infer` spend-meter boundary;
  ADR-0003 retention-scope amendment). They live in the spec's Open questions table. Neither
  blocks M1.
