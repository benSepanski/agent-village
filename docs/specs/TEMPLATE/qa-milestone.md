# QA: M<n> <title>

Milestone: `../milestones/M<n>-<slug>.md`
Date: YYYY-MM-DD
Verdict: Pass | Pass with follow-ups | Fail

## What was exercised

The commands run and the paths taken, precisely enough to repeat. Not "tested the CLI" — the actual
invocations, inputs, and environment.

## Criteria

One row per acceptance criterion the milestone claims. **Evidence is observed output**, not a
restatement of the criterion. `Not verified` is an honest and acceptable result; a criterion marked
met without evidence is not.

| ID      | Result                       | Evidence |
| ------- | ---------------------------- | -------- |
| AC-M1.1 | Met / Not met / Not verified |          |

## Audit check

Did the milestone actually emit what its audit surface promised? Show a record, including one for a
denial or failure path — the paths most likely to be silent.

| Promised event | Observed | Principal attributable | Retention bound honoured |
| -------------- | -------- | ---------------------- | ------------------------ |

## Findings

Defects, gaps, and surprises, worst first. Each with what it breaks and what it would take to fix.
Distinguish "violates the spec" from "the spec did not say" — the second is a spec finding and goes
to the owner, not into a fix.

| #   | Severity | Finding | Breaks | Disposition |
| --- | -------- | ------- | ------ | ----------- |

## Not covered

What this pass did not check, and why — cost, environment, time, or something genuinely untestable
today. This section is what makes the verdict trustworthy.

## Verdict

The judgement and its reason. If `Pass with follow-ups`, list the follow-ups and where they were
recorded (milestone, spec open question, or ADR). Do not pass a milestone to avoid a conversation.
