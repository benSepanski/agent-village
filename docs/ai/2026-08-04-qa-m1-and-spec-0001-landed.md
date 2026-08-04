# M1 QA'd (pass with follow-ups); draft spec 0001 landed; acceptance ask sent

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

**Notification sent this run (2026-08-04): draft spec 0001 needs owner acceptance.** Do not re-send;
if still unaccepted, one reminder is warranted no earlier than 2026-08-11. Note for the owner
reviewing it: ADR-0006 substantially overlaps accepted ADR-0004 (same stack, agent-cli scope, plus
zod / `node:https` / lint-rule decisions), and its Context section predates M1 — worth deciding
whether it stays a separate ADR or folds into an amendment when ruling on the spec.

Next run, per the routing table: spec 0002 is `Accepted` with M1 done and QA'd — **execute M2**
([topology-checker](../specs/0002-agent-environment/milestones/M2-topology-checker.md),
[execute-a-milestone](../dev/workflows/execute-a-milestone.md)). Building spec 0001 needs owner
acceptance first; do not start it while it is `Draft`.

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
