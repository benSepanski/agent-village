# Execute a milestone

Input: a milestone in an `Accepted` spec. Output: the slice built, verified, and committed.

## Start

1. **Read the milestone, then the spec.** The milestone says what; the spec says why and constrains
   how. Use the spec's terminology in the code — drift here is how a design and its implementation
   quietly separate.
2. **Check the ADRs** that touch this area. If your approach contradicts one, stop and write an ADR
   ([write-an-adr](write-an-adr.md)) — do not decide it in a PR.
3. **Confirm the scope.** Anything outside the milestone's slice belongs to another milestone or to
   the spec's non-goals. If the slice turns out to be wrong, say so before building around it.
4. **Set the milestone status** to `In progress` in `milestones/README.md`.

## Build

- **Work the slice end to end**, not layer by layer. A thin path that runs beats three components
  that have never met.
- **Emit the audit records as you build the paths that produce them.** Retrofitting produces logs of
  whatever was convenient rather than of the decisions that mattered — the denials and the no-ops.
- **Validate at boundaries**, and refuse rather than coerce. Inside a boundary, write the clearest
  thing.
- **Delete as you go.** No commented-out alternatives, no notes about what this used to be
  ([ADR-0002](../../adr/0002-history-over-commentary.md)).
- **Keep the harness green as you go**, not at the end. Never weaken a check to pass; if a check is
  wrong, that is an ADR.
- **Update the docs the change invalidated** in the same change. A doc fixed "later" is a doc that
  misleads in between.

## When something is not in the milestone

| Situation                                         | Do                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| A small fix in the path you are already touching  | Fix it, mention it in the commit body                                     |
| A defect that blocks this milestone               | Fix it, and record it in the milestone doc                                |
| A defect elsewhere that does not block you        | Record it in the QA findings or `docs/ai/`; do not expand the change      |
| The spec is ambiguous about what you are building | Resolve it with the owner; record the answer as a spec amendment          |
| The spec is wrong                                 | Stop. Write the case up and take it to the owner — do not route around it |

## Verify

Run the milestone's own verification section — it was written before the work, which is the point.
Then the harness:

```bash
pnpm check
```

Confirm each criterion by observing the system, not by reasoning that it must hold. A criterion you
could not check is `Not verified`, and that is an acceptable thing to say. Claiming verification you
did not do is not.

## Commit

Conventional commits, one logical change each. The body carries the _why_, the rejected
alternatives, and anything unverified — git is the only record of those
([ADR-0002](../../adr/0002-history-over-commentary.md)). Cite the criterion ID (`AC-M1.2`).

## Done when

- Every criterion the milestone claims is met and observed, or explicitly recorded as not verified.
- The promised audit records exist, including on a denial or failure path.
- `pnpm check` passes.
- Affected docs are updated; nothing new contradicts the spec.
- The milestone status is `Complete` and the work is committed.

Next: [qa-a-milestone](qa-a-milestone.md). QA is a separate pass, and preferably a fresh session —
the point is to check the work, not to re-confirm the reasoning that produced it.
