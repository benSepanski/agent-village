# QA a milestone

Input: a milestone marked `Complete`. Output: a QA document in the spec's `qa/` directory with a
verdict and evidence.

Do this in a **fresh session** where possible. The failure mode of self-QA is re-running the
reasoning that produced the work instead of checking the work.

## Stance

You are trying to find out whether the claims are true, which mostly means trying to make them
false. Start from the milestone's criteria and the system as it actually is — not from the
implementer's account of it.

Two rules:

- **Evidence is observed output.** A criterion is met when you saw it be met. Restating the
  criterion in the past tense is not evidence.
- **`Not verified` is a real result.** Honest gaps are useful; false confidence is corrosive, and it
  compounds because later work is built on it.

## Do

```bash
cp docs/specs/TEMPLATE/qa-milestone.md docs/specs/NNNN-<slug>/qa/M1-<slug>.md
```

1. **Run the milestone's verification section** exactly as written. If it cannot be followed as
   written, that is finding number one.
2. **Check every criterion** and record what you observed.
3. **Attack the boundaries.** Absent input, malformed input, wrong principal, concurrent access,
   oversized input, interruption mid-flight. The spec's edge cases are the starting list, not the
   whole one.
4. **Check the audit surface** — the part most likely to be quietly missing. Was a denial recorded?
   Is the principal attributable? Does the retention bound exist and hold? Read a record and confirm
   you could reconstruct what happened from it alone.
5. **Check for scope creep.** Anything built that the milestone put out of scope, or that the spec
   listed as a non-goal, is a finding even if it works.
6. **Check terminology.** Does the code use the spec's words for the spec's things?
7. **Run `pnpm check`** plus whatever checks the spec has introduced.

## Classify findings

| Kind                             | Goes to                                                           |
| -------------------------------- | ----------------------------------------------------------------- |
| Violates the milestone criteria  | Fix now; the milestone is not done                                |
| Violates the spec                | Fix now, or escalate if the fix is large                          |
| The spec did not say             | A spec finding — record it for the owner, do not invent an answer |
| Out of scope, real, not blocking | Findings table, and `docs/ai/` if it needs to survive the session |

The third row is the one that gets mishandled. When the spec is silent, the answer is a
conversation, not a choice made quietly inside a QA pass.

## Verdict

- **Pass** — every criterion met and observed.
- **Pass with follow-ups** — met, with defects recorded and homed. List where each went.
- **Fail** — a criterion is not met. Say which and what it would take.

Update `milestones/README.md` with the verdict and a link. Do not pass a milestone to avoid a
conversation; the conversation gets more expensive every milestone you defer it.

## Done when

- Every criterion has a result and evidence.
- The audit check includes a failure or denial path.
- Findings are classified and homed.
- "Not covered" says what this pass did not check and why.
- The verdict is recorded in the milestone index.

Next: the next milestone, or [qa-a-spec](qa-a-spec.md) when they are all done.
