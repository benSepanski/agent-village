# QA: spec <NNNN-slug>

Spec: `../spec.md`
Date: YYYY-MM-DD
Verdict: Complete | Incomplete | Nonviable

Milestone QA checks a slice against its own criteria. This checks the **whole spec**: whether what
was built is the system the spec described, and whether that system was worth building.

## Acceptance criteria

Every criterion in the spec, with the evidence — usually a milestone QA doc plus a direct check that
the pieces work together, since criteria satisfied separately can still fail in composition.

| ID     | Result                       | Evidence |
| ------ | ---------------------------- | -------- |
| AC-1.1 | Met / Not met / Not verified |          |

## Guarantees

Each guarantee in the spec, tested against its stated assumptions — including at least one attempt
to violate it. A guarantee nobody tried to break is an untested claim.

| Guarantee | Holds | How it was probed | Assumption still true |
| --------- | ----- | ----------------- | --------------------- |

## Terminology drift

Does the code use the spec's words for the spec's things? Drift here is the leading indicator that
the design and the implementation have quietly separated.

| Term | Used as specified | Where it drifted |
| ---- | ----------------- | ---------------- |

## Audit surface

Can one session be reconstructed end to end from records alone? Are denials recorded? Is one
principal's data unreadable by another? Are retention bounds real and enforced?

## Non-goals

Did anything out of scope get built anyway? Scope creep found here is cheap; found in the next spec
it is a rewrite.

## Design findings

Where the spec itself was wrong, vague, or unbuildable — as distinct from implementation defects.
These are the input to the owner's next decision, so state them plainly.

| #   | Finding | Impact | Recommendation |
| --- | ------- | ------ | -------------- |

## Verdict and recommendation

`Complete`, `Incomplete` (with what remains), or `Nonviable` (with the evidence that continuing is
wrong). The owner decides what happens next; this document makes that decision possible, and states
the case rather than asserting the conclusion.
