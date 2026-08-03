# Design specs

A design spec is **the design target**: precise enough that two competent builders would produce
compatible systems from it, and honest enough that its own weak points are written down.

Specs are the only thing that authorizes implementation. No accepted spec, no code
([ADR-0001](../adr/0001-docs-first-spec-driven-reset.md)).

## Index

| Spec                                   | Title             | Status |
| -------------------------------------- | ----------------- | ------ |
| [0002](0002-agent-environment/spec.md) | agent-environment | Draft  |

## Layout

One directory per spec, holding the spec and its entire execution record:

```
docs/specs/0001-agent-cli/
  spec.md              # the design target
  milestones/
    README.md          # index + status of this spec's milestones
    M1-<slug>.md       # one slice, with acceptance criteria AC-M1.n
  qa/
    README.md          # index of QA passes
    M1-<slug>.md       # QA of a milestone
    spec-<date>.md     # QA of the spec as a whole
```

Skeletons live in [TEMPLATE/](TEMPLATE/) — one canonical copy of each, so they cannot drift per spec.

Numbering is sequential from `0001`, never reused. The slug is stable — rename the title in the
document, not the directory, or every existing link dies.

## Lifecycle

| Status               | Means                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `Draft`              | Under discussion. Nothing is binding. Freely rewritten.                                  |
| `Accepted`           | The owner accepted it. Terminology and guarantees are binding; implementation may start. |
| `Completed`          | Every acceptance criterion met and QA'd against the spec.                                |
| `Abandoned`          | Found nonviable or to carry issues large enough that continuing is wrong. Say why.       |
| `Superseded by NNNN` | Replaced by a later spec.                                                                |

Only the owner moves a spec to `Accepted` or `Abandoned`. An agent that believes a spec is nonviable
writes the case up and asks — it does not decide.

**Accepted specs are edited only by amendment**: append to a `Changes since acceptance` section with
the date, what changed, and why. Silent edits to an accepted spec break every milestone that cites
it. A change large enough to invalidate the milestones is a new spec that supersedes this one.

## What a spec must contain

Sections, in [TEMPLATE/spec.md](TEMPLATE/spec.md):

| Section             | Answers                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------ |
| Design goals        | What this must achieve, and how we would know it did                                       |
| Terminology         | Every term used with a precise meaning. Binding on acceptance — code uses these words      |
| User flows          | What actually happens, from the point of view of whoever triggers it                       |
| Architecture        | Components, their contracts, and what crosses between them                                 |
| Guarantees          | What holds always, and under what assumptions                                              |
| Audit surface       | Per [ADR-0003](../adr/0003-auditability-is-a-requirement.md) — required, not optional      |
| Edge cases          | What happens when things are concurrent, absent, hostile, or oversized                     |
| Non-goals           | What this deliberately does not do, so scope creep is a visible violation                  |
| Scoping guidance    | How to decide, mid-build, whether something belongs in this spec                           |
| Acceptance criteria | Testable statements with stable IDs — the definition of Completed                          |
| Open questions      | What is genuinely unresolved. An empty list on a first draft means the draft is not honest |

## Rules of thumb

- **Terminology is the highest-leverage section.** Most design disagreement is two people using one
  word for different things. Write the glossary early and fight about it there.
- **Guarantees name their assumptions.** "Isolated" means nothing; "no instance can read another
  instance's filesystem, assuming the runtime enforces mount namespaces" can be checked.
- **Non-goals are load-bearing.** They are what stops a milestone from quietly becoming a project.
- **Write down what you do not know.** Open questions are the raw material of the next discussion,
  and a spec that pretends to certainty produces milestones that discover it the expensive way.

Guide to writing one: [../dev/workflows/author-a-spec.md](../dev/workflows/author-a-spec.md).
