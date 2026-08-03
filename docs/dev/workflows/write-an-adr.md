# Write an ADR

An ADR records a decision and the reasoning that produced it, so nobody has to reconstruct the
argument from the code. Format: [adr.github.io](https://adr.github.io).

## When

Write one when the decision:

- constrains future work (a runtime, a storage model, a protocol, a trust boundary);
- is expensive to reverse;
- applies repo-wide;
- contradicts or amends an existing ADR;
- or would make a future reader ask "why on earth is it like this?".

**The tell:** if you are defending a choice in a PR comment, the argument belongs in an ADR, where
the next agent will find it. Conversely, do not write ADRs for cheap, local choices — an ADR log
full of trivia is one nobody reads.

Decisions inside an accepted spec are usually already recorded by the spec. Write an ADR when the
decision outlives that spec.

## Do

```bash
cp docs/adr/TEMPLATE.md docs/adr/NNNN-<kebab-slug>.md
```

1. **Context** — the situation that forces a choice. Which constraints are facts and which are
   assumptions? A reader should be able to judge the decision without having been there.
2. **Decision** — plain words, specific enough to check the code against.
3. **Alternatives considered** — with the real reason each was rejected. This is the section future
   readers actually need; "we chose X" without the discards invites relitigating it every year.
4. **Consequences** — what gets easier, what gets harder, what cost we accept, and the **observable
   trigger** that would make us revisit. Not "if it becomes a problem" — say what the problem looks
   like.
5. **Audit surface** — what the decision implies for what gets recorded
   ([ADR-0003](../../adr/0003-auditability-is-a-requirement.md)). "None" is allowed with a reason.
6. Add a row to the [ADR index](../../adr/README.md).

## Rules

- **Append-only.** Never rewrite an accepted ADR. Write a new one and set the old one's `Status:` to
  `Superseded by ADR-NNNN` — that status line is the single permitted edit.
- **Number sequentially, never reuse.** Numbers are cited elsewhere.
- **One decision per ADR.** Two decisions in one document cannot be superseded independently.
- **Proposed is real.** An ADR can sit at `Proposed` while it is argued. Only the owner accepts one.
- **Prefer honest to tidy.** "We picked this because we had two days" is a legitimate context, and it
  tells a future reader exactly how much weight the decision should carry.

## Done when

- Context, Decision, Alternatives, Consequences, Audit surface are all filled with content.
- The revisit trigger is observable.
- The index row exists, and any superseded ADR points here.
- `pnpm check` passes.
