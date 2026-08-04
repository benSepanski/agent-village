# M1 QA'd (pass with follow-ups); spec 0001 landed and accepted

2026-08-04, second autonomous routine run of the day.

Done this run:

- **PR #45 triaged and merged.** It carried draft spec 0001 (agent-cli) plus two ADRs, forked from
  main at #37, and its stack ADR collided with the accepted
  [ADR-0004](../adr/0004-typescript-node-stack.md). Resolution: merged main into the branch, kept
  main's current dev README (the PR side predated M1 and would have reverted it), renumbered the
  branch's ADR to [ADR-0006](../adr/0006-typescript-node-for-agent-cli.md) with all references
  updated, squash-merged on green CI. ADR-0005 and ADR-0006 are both `Proposed`; spec 0001 is
  `Draft`.
- **M1 QA'd**: [qa/M1-walking-skeleton.md](../specs/0002-agent-environment/qa/M1-walking-skeleton.md),
  verdict **Pass with follow-ups**, from a fresh fixture run against a live Docker daemon, with a
  negative control for the network sweep and a hostile pass at the bridge socket. Follow-ups are in
  the QA doc's findings table: validate the wire `op` field (M2), channel-mount write policy (M3).
  None blocks M2.

**The acceptance ask is closed.** The notification went out 2026-08-04 and the owner accepted spec
0001 the same day, in the session that sent it; the status flip is recorded in the spec and the
index. Do not re-send anything about it. Still open from that review, for the owner when convenient:

- [ADR-0005](../adr/0005-socket-derived-principal-and-grant-layout.md) and
  [ADR-0006](../adr/0006-typescript-node-for-agent-cli.md) remain `Proposed` — the owner accepted
  the spec, not (explicitly) the ADRs. ADR-0006 substantially overlaps accepted ADR-0004 (same
  stack, agent-cli scope, plus zod / `node:https` / lint-rule decisions) and its Context predates
  M1. Spec 0001's M1 needs the stack settled, so ask for these two rulings before building it.
- Spec 0001's open questions were not ruled on at acceptance; Q3 (grant-directory layout,
  inter-spec with agent-environment) blocks the most.

Next run, per the routing table: **two specs are now `Accepted` with unfinished milestones** —
spec 0002 at M2, spec 0001 at its M1. The owner has not named a priority. Absent a ruling, continue
with [spec 0002 M2](../specs/0002-agent-environment/milestones/M2-topology-checker.md)
([execute-a-milestone](../dev/workflows/execute-a-milestone.md)): it is the routing the previous
notes already point at, and spec 0001's M1 is gated on the ADR rulings above anyway.

Unresolved, carried forward from the previous note
([2026-08-04-m1-execution-run.md](2026-08-04-m1-execution-run.md)):

- **Branch protection**: PRs merge via the API with only `format_and_links` + `typecheck_lint_test`
  green and no review; the routine prompt says the ruleset requires a review and a
  `lint_typecheck_test_synth` check no workflow produces. Owner should verify the ruleset does what
  they intend. One reminder warranted if unaddressed, none before 2026-08-10.
- Spec 0002's open questions still hold two owner rulings (`model.infer` spend-meter boundary;
  ADR-0003 retention-scope amendment). Neither blocks M2. Spec 0001's Q3 asks whether
  agent-environment accepts the `grants/<app>/<instance>/<session>/` layout — an inter-spec ruling
  the owner should make at acceptance time.
