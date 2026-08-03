# M<n>: <title>

Spec: `../spec.md`
Status: Planned | In progress | Complete | Blocked | Dropped
Depends on: M<n>, or `—`

## Slice

What this milestone makes true that was not true before, in one paragraph. A milestone is a slice
someone could use or observe, not a layer of the eventual architecture — "an agent can invoke one
wrapped command and see the approval recorded" is a slice; "the data layer" is not.

## Out of scope

What a reader might reasonably expect here but will not get, and which milestone gets it instead.
This is where scope creep becomes visible.

## Acceptance criteria

Testable statements with stable IDs. Cite the ID in commits, PRs, and QA — never a paraphrase. Each
criterion traces to the spec criterion it serves.

| ID      | Criterion | Serves | Verified by |
| ------- | --------- | ------ | ----------- |
| AC-M1.1 |           | AC-1.1 |             |

## Audit surface

What this milestone must record, per ADR-0003 (`docs/adr/0003-auditability-is-a-requirement.md`):
events, principal, correlation identifiers, destination, retention bound, and what is never recorded.
A milestone that adds a trust boundary and no audit events is not done.

## Approach

The intended shape of the work — components touched, the order, and what could go wrong. Enough that
a fresh session can pick this up; not a substitute for reading the spec.

## Decisions needed

Anything that must be settled before or during this milestone, and whether it warrants an ADR
(`docs/adr/`). Empty is fine; unrecorded is not.

## Verification

How a QA pass reproduces the result: exact commands, what to look for, what evidence to capture.
Written before the work starts, so "it works" cannot be defined after the fact.
