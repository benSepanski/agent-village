# Spec NNNN: <title>

Status: Draft | Accepted | Completed | Abandoned | Superseded by NNNN
Accepted: YYYY-MM-DD (or `—`)
Supersedes: <spec, or `—`>

## Summary

Three sentences: what this builds, for whom, and why now. If you cannot write this without hedging,
the design is not ready to write down yet.

## Design goals

What this must achieve, ranked, each with the observation that would tell us it was achieved.

| Goal | Achieved when |
| ---- | ------------- |
|      |               |

## Terminology

Every term this spec gives a precise meaning. **Binding on acceptance** — the code uses these words
for these things and no others. Define the term, not the implementation.

| Term | Means |
| ---- | ----- |
|      |       |

## User flows

What happens, from the point of view of whoever triggers it. One subsection per flow: the trigger,
the steps, what the actor sees, and how it ends — including how it ends badly.

## Architecture

The components, what each is responsible for, and the contract at every boundary between them: what
crosses, in what shape, and who is trusted to produce it. Say what is deliberately left to the
implementation.

## Guarantees

What holds always, stated so it can be checked, each with the assumptions it rests on.

| Guarantee | Holds because | Assumes |
| --------- | ------------- | ------- |
|           |               |         |

## Audit surface

Required — see [ADR-0003](../../adr/0003-auditability-is-a-requirement.md). What is recorded, on whose
behalf, with what correlation identifiers, where it goes, who may read it, how long it is kept and
what happens at the bound, and what is deliberately never recorded.

## Edge cases

What happens when things are concurrent, absent, malformed, hostile, oversized, or interrupted
mid-flight. One row per case; "undefined" is an acceptable answer only if it is written down as one.

| Case | Behaviour |
| ---- | --------- |
|      |           |

## Non-goals

What this deliberately does not do. Each with a one-line reason, so a later reader can tell "not
yet" from "not ever".

## Scoping guidance

How to decide, mid-build, whether a thing belongs in this spec. Concrete tests beat principles:
"anything touching the credential store is in scope; anything about UI presentation is not."

## Acceptance criteria

Testable statements. Stable IDs — cite the ID, never a paraphrase. These are the definition of
`Completed`.

| ID     | Criterion | Verified by |
| ------ | --------- | ----------- |
| AC-1.1 |           |             |

## Open questions

What is genuinely unresolved, and what would settle it. Empty on a first draft means the draft is
not honest yet.

| Question | Blocks | Resolved by |
| -------- | ------ | ----------- |
|          |        |             |

## Changes since acceptance

Amendments only, append-only, newest last. Before acceptance, edit the spec freely and leave this
section empty.

| Date | Change | Why |
| ---- | ------ | --- |
|      |        |     |
