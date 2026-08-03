# Author a design spec

A spec is produced by **iterating with the owner**, not written in one pass and presented. Your job
is to make the disagreements visible early, while they are cheap.

## Before writing

- Read [../../specs/README.md](../../specs/README.md) (what a spec must contain) and
  [../design-principles.md](../design-principles.md) (the bar it is held to).
- Read the ADRs. A spec that contradicts an accepted ADR must either respect it or supersede it
  explicitly — never quietly.
- Skim [../../legacy/](../../legacy/) if the area overlaps v0. Mine the reasoning; do not inherit
  the conclusions.

## Create it

```bash
mkdir -p docs/specs/NNNN-<slug>/{milestones,qa}
cp docs/specs/TEMPLATE/spec.md docs/specs/NNNN-<slug>/spec.md
```

Add a row to the index in [../../specs/README.md](../../specs/README.md) with status `Draft`.

## Write it in this order

The order matters — each section constrains the next, and doing them out of order produces a spec
that argues with itself.

1. **Terminology first.** Most design disagreement is two people using one word for two things.
   Write the glossary before the architecture and fight about it there, where a fix costs a line.
2. **User flows.** What actually happens, from the point of view of whoever triggers it, including
   how it ends badly. Flows expose missing concepts faster than diagrams do.
3. **Non-goals.** Write these early, while saying no is still easy.
4. **Architecture and contracts.** Components, responsibilities, and what crosses each boundary.
   Every boundary names what it validates and what it refuses.
5. **Guarantees, with assumptions.** "Isolated" is not a guarantee. "No instance can read another's
   filesystem, assuming the runtime enforces mount namespaces" is one, because it can be probed.
6. **Audit surface.** Required — [ADR-0003](../../adr/0003-auditability-is-a-requirement.md). If you
   cannot say what is recorded, on whose behalf, and for how long, the design is not finished.
7. **Edge cases.** Concurrent, absent, malformed, hostile, oversized, interrupted. Go looking; they
   do not volunteer.
8. **Acceptance criteria.** Testable, stably numbered. If a criterion cannot be checked by observing
   the system, rewrite it until it can.
9. **Open questions.** What is genuinely unresolved and what would settle it.

## Iterating with the owner

- **Bring options with a recommendation**, not a menu. State the trade-off in one line each and say
  which you would pick and why.
- **Surface disagreement rather than averaging it.** A spec that splits the difference between two
  coherent designs is usually incoherent.
- **Write down what you are unsure about.** Open questions are the agenda for the next round. A
  first draft with no open questions is not honest.
- **Do not smuggle in decisions.** If a paragraph settles something that was never discussed, call
  it out explicitly or it will be discovered halfway through a milestone.
- **Prototype only to answer a question**, and say so. Throwaway code that answers "is this even
  possible" is legitimate; code that quietly becomes the implementation is not.

## Done when

- Every template section is filled with content, not placeholders.
- Terminology covers every term the spec relies on, and the rest of the spec uses those words.
- Every guarantee names its assumptions; every acceptance criterion is observable.
- The audit surface is specific: events, principal, correlation, destination, retention, exclusions.
- Non-goals and scoping guidance are concrete enough to settle a mid-build scope argument.
- Open questions are either resolved or explicitly deferred with what unblocks them.
- `pnpm check` passes.

**Only the owner accepts a spec.** When you believe it is ready, say so and hand it over — do not
set the status yourself. On acceptance it becomes binding: after that, edit only by amendment
(see [../../specs/README.md](../../specs/README.md)).

Next: [decompose-into-milestones](decompose-into-milestones.md).
