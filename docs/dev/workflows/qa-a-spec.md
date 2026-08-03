# QA a spec

Input: a spec whose milestones are all complete and QA'd — or one that has gone badly enough to
question. Output: a QA document and a recommendation to the owner.

Milestone QA asks "does this slice do what it claimed?". Spec QA asks two harder questions: **is
what we built the system the spec described, and was the spec right?**

## Do

```bash
cp docs/specs/TEMPLATE/qa-spec.md docs/specs/NNNN-<slug>/qa/spec-YYYY-MM-DD.md
```

1. **Check every spec-level criterion in composition.** Criteria satisfied by separate milestones
   can still fail together; that interaction is what this pass exists to find.
2. **Probe every guarantee.** For each one, try to violate it, and check whether its stated
   assumptions are still true. A guarantee nobody attacked is an untested claim.
3. **Reconstruct a session from records alone.** If you cannot say what happened without reading the
   code, the audit surface failed regardless of what is emitted
   ([ADR-0003](../../adr/0003-auditability-is-a-requirement.md)).
4. **Check isolation between principals** if the spec claims any: can one read another's data,
   logs, or filesystem?
5. **Check terminology drift.** Where the code stopped using the spec's words, the design and the
   implementation have separated. Say where.
6. **Check the non-goals.** Anything built that the spec excluded is scope creep, cheap to find now
   and expensive later.
7. **Re-read the spec as a design document.** Where was it vague, wrong, or unbuildable? Which open
   questions were never resolved but got built around anyway?

## Verdict

| Verdict      | Means                                                                                  |
| ------------ | -------------------------------------------------------------------------------------- |
| `Complete`   | Every criterion met, guarantees hold, audit surface real. Recommend closing the spec.  |
| `Incomplete` | Specific gaps remain. Name them and what closes each.                                  |
| `Nonviable`  | Continuing is wrong: the design does not work, or it works at a cost not worth paying. |

## Calling a spec nonviable

This is a legitimate and valuable outcome, and it is the owner's decision. Your job is to make the
case, not the call.

State: what was tried, what specifically fails, why the failure is in the design rather than the
implementation, what would have to change, and what you would recommend instead. "This is hard" is
not nonviable. "This requires a guarantee the runtime cannot give, so every flow that depends on it
needs a different mechanism" is.

Be equally careful the other way. Declaring a spec complete when a guarantee was never probed poisons
every decision built on it.

## Then

- Record the verdict in the spec index and in the spec's status line.
- Take it to the owner with a recommendation.
- Close the spec out: [archive-a-spec](archive-a-spec.md).
- **Ask for the next spec.** The outer loop ends with the owner deciding what is next — not with an
  agent starting something.

## Done when

- Every criterion has a result and evidence.
- Every guarantee was probed, not assumed.
- Design findings are separated from implementation defects.
- The verdict is recorded, and the owner has what they need to decide.
