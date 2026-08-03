# Close a spec out

A spec ends as `Completed` or `Abandoned`. Both are successes if they are honest and documented; the
only failure is a spec that trails off with nobody able to say what happened.

**Only the owner sets the final status.** This guide is how you prepare the decision and record it
afterwards.

## Before

- A spec QA pass exists with a verdict: [qa-a-spec](qa-a-spec.md).
- Every milestone is `Complete`, or explicitly `Dropped` with a reason.
- Findings are homed: fixed, recorded as spec findings, or carried into the recommendation.

## Completed

1. Set the spec's status to `Completed`, with the date.
2. Update the row in [../../specs/README.md](../../specs/README.md).
3. **Graduate the durable parts.** A spec is a design target, not a permanent reference. Anything
   still load-bearing belongs where it will be found and maintained:
   - decisions that outlive the spec → [ADRs](../../adr/)
   - how to use or run what was built → [../](../) (dev docs)
   - guarantees future work must not break → the ADR that states them
4. **Prune `docs/ai/`** of notes that were about getting here. Stale scratch misleads.
5. The spec, its milestones, and its QA stay in place. They are the record of what was intended and
   what was found — not a live reference.

## Abandoned

A spec is abandoned when it is nonviable, or when continuing costs more than it is worth. Record it
properly, because the next spec is written by someone reading this.

1. Set the status to `Abandoned`, with the date.
2. Add an **Outcome** section to the spec stating: what was built, what specifically failed, why the
   failure is in the design rather than the implementation, what was ruled out (this is the most
   valuable part — a ruled-out approach saves the next attempt), and what you would try instead.
3. **Write an ADR** if the abandonment establishes something durable: an approach that does not
   work, or a constraint discovered the hard way. This is how a dead end becomes knowledge instead
   of a repeated experiment.
4. **Decide what happens to the code**, with the owner. Default is delete: git remembers, and
   half-built code that no accepted spec covers is the most misleading thing in a repo
   ([ADR-0002](../../adr/0002-history-over-commentary.md)). Keeping it needs a reason and a note
   saying what it is.
5. Prune `docs/ai/` the same way.

## Then, either way

Report to the owner: what the spec set out to do, what happened, what was learned, and what you
would recommend next — **and ask for the next spec.** The outer loop closes with the owner's
decision, not an agent's initiative.

## Done when

- The spec's status and the index row agree, with a date.
- A QA doc supports the verdict.
- Durable knowledge is graduated to an ADR or a dev doc.
- Abandoned specs carry an Outcome section that would save the next attempt real time.
- Scratch notes are pruned; `pnpm check` passes.
