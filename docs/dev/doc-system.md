# Where writing goes

Every kind of writing has exactly one home. Guessing is not required.

| You are writing                                        | It goes                                                                 | Lifetime                     |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------- |
| A design target: goals, terminology, flows, guarantees | [../specs/](../specs/) — `NNNN-slug/spec.md`                            | Permanent, amended by append |
| A buildable slice of an accepted spec                  | that spec's `milestones/`                                               | Permanent                    |
| The result of checking work against criteria           | that spec's `qa/`                                                       | Permanent                    |
| A decision that is costly to reverse                   | [../adr/](../adr/)                                                      | Permanent, append-only       |
| How to use or navigate the repo                        | [./](./) (this directory)                                               | Living — edited to stay true |
| A step-by-step process for agents                      | [workflows/](workflows/)                                                | Living                       |
| Session handoffs, investigations, half-formed thinking | [../ai/](../ai/)                                                        | Prunable — delete when stale |
| Why the code changed                                   | the commit message ([ADR-0002](../adr/0002-history-over-commentary.md)) | Permanent, in git            |
| Docs for a system that no longer exists                | [../legacy/](../legacy/)                                                | Frozen                       |

Two things that have **no** home, deliberately: a changelog (git is the changelog) and a doc that
re-describes what code, a schema, or a test already states (link to the source instead).

## Rules for any doc

- **One question, one doc, one screen.** If a doc answers two questions, split it. If it does not
  fit on a screen, it is either two docs or it is padded.
- **Routers route.** [../README.md](../README.md) and directory READMEs are indexes: question in the
  left column, link in the right. They do not hold content of their own, so they never go stale in
  an interesting way.
- **Link instead of repeating.** A fact stated twice is a fact that will be wrong in one place. The
  link checker makes links safe to rely on, so use them.
- **Present tense, current state.** No history sections, no "previously we…", no dated notes about
  what changed. That is git's job.
- **Write for a reader with no context.** No "as discussed", no unexplained pronouns across
  sections, no assumption that the reader has the previous doc in mind.
- **Delete on sight.** A doc describing something that no longer exists is worse than a missing doc,
  because it is trusted. Deleting is cheap; git keeps it.

## Adding a doc

1. Check the table above. If nothing fits, that is interesting — say so rather than inventing a
   directory.
2. Write it so it answers one question.
3. Add a row to the directory's README **and** to [../README.md](../README.md) if the question is one
   a newcomer would ask. An unlinked doc does not exist.
4. Run `pnpm check`.

## Naming

- Files: `kebab-case.md`, named for the question they answer (`author-a-spec.md`, not `spec-howto.md`).
- Specs: `NNNN-kebab-slug/`, sequential, never renumbered or renamed after creation.
- ADRs: `NNNN-kebab-slug.md`, sequential, never renumbered.
- Milestones: `M<n>-kebab-slug.md`, with criteria `AC-M<n>.<k>`.
- Scratch notes: `YYYY-MM-DD-kebab-topic.md`.
