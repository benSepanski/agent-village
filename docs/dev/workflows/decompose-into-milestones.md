# Decompose a spec into milestones

Input: an `Accepted` spec. Output: an ordered set of slices, each independently buildable and
checkable.

## What a milestone is

**A milestone is a slice through the system, not a layer of it.** "An agent can invoke one wrapped
command and the approval is recorded" is a milestone. "The storage layer" is not — nobody can tell
whether a layer works, so its QA is vacuous and its defects surface three milestones later.

Each milestone should:

- Make something observably true that was not true before.
- Be checkable against its own criteria, without the milestones after it.
- Carry its own audit surface — a slice that adds a trust boundary and no records is not a slice.
- Be small enough that a session can hold it. If the slice statement needs more than a paragraph,
  split it.

## How to slice

1. **List the spec's acceptance criteria.** Every criterion must be served by at least one
   milestone; a criterion nothing serves means the decomposition is incomplete.
2. **Find the thinnest end-to-end path** — the smallest thing that touches every layer it needs and
   produces an observable result. That is M1. Depth beats breadth: an ugly working path teaches you
   more than three polished components that have never met.
3. **Grow the path.** Each later milestone adds capability, hardening, or a second case, along the
   path that already works.
4. **Put the risky decisions early.** If something might make the spec nonviable, find out in M1 or
   M2, not M6. The point of the inner loop is to fail cheap.
5. **Sequence by dependency, and say so.** A milestone that depends on nothing later can be built,
   QA'd, and left alone.

## Write them

One file per milestone, from the template:

```bash
cp docs/specs/TEMPLATE/milestone.md docs/specs/NNNN-<slug>/milestones/M1-<slug>.md
```

Plus `milestones/README.md` as the index:

```markdown
# Milestones — <spec title>

| Milestone                 | Slice    | Status  | QA  |
| ------------------------- | -------- | ------- | --- |
| [M1-<slug>](M1-<slug>.md) | one line | Planned | —   |
```

Number criteria `AC-M<n>.<k>` and trace each to the spec criterion it serves. These IDs are cited in
commits, PRs, and QA docs, so they never change once written.

## Done when

- Every spec acceptance criterion is served by at least one milestone.
- Every milestone has a slice statement, out-of-scope list, criteria, audit surface, and a
  verification section written **before** any work starts.
- Dependencies are stated and the order is acyclic.
- M1 exercises the riskiest assumption in the spec.
- The index README lists them all.
- `pnpm check` passes.

Next: [execute-a-milestone](execute-a-milestone.md).
