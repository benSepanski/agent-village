# M1 executed; ADR-0004 awaits owner acceptance

2026-08-04. Autonomous routine run.

Repo state at this run: no open PRs; spec 0002 `Accepted`; all milestones `Planned`. Per the
routing table that means execute M1. Done:

- [ADR-0004](../adr/0004-typescript-node-stack.md) (TypeScript on Node 22) written at `Proposed` —
  M1 delegates the pick, but only the owner accepts an ADR. Code was built against it because
  blocking every milestone on acceptance would stall the spec; if the owner rejects it, M1 is small
  enough to rewrite.
- M1 built in `packages/agent-environment` and verified: all six criteria pass against a live
  Docker run (`pnpm --filter @agent-village/agent-environment fixture:m1` reproduces this; needs a
  Docker daemon). Milestone doc records the channel-carrier decision.
- `pnpm check` now includes typecheck, lint, and unit tests; CI gained a `typecheck_lint_test` job.

Notification sent this run (2026-08-04): ADR-0004 needs owner acceptance. Do not repeat before
2026-08-11.

Next run: M1 is `Complete` but not QA'd — per the routing table, QA it
([qa-a-milestone](../dev/workflows/qa-a-milestone.md)). The fixture command prints per-criterion
PASS/FAIL and the journal path; QA evidence should come from a fresh run, not this run's.

Unresolved, carried forward:

- **Branch protection**: the routine prompt says `main` requires an approving review and a check
  named `lint_typecheck_test_synth`, but PRs #39–#42 squash-merged via the API with green
  `format_and_links` only. Owner should verify the ruleset on `main` does what they intend. No
  notification sent about this; if still unaddressed one reminder is warranted (none before
  2026-08-10). Note the new CI job is named `typecheck_lint_test` — if the owner meant the ruleset
  to require a code check, the name to require is that one.
- Spec 0002's open questions include two owner rulings (`model.infer` spend-meter boundary;
  ADR-0003 retention-scope amendment). They live in the spec's Open questions table. Neither
  blocks M2.
