# ADR 0002: History over commentary

Date: 2026-08-02
Status: Accepted
Driver: repo-wide

## Context

Codebases accumulate a shadow history in their source: commented-out blocks kept "just in case",
`// changed 2026-04-11 to fix the retry bug`, `// old approach below`, version tables in module
headers, changelog sections in docs. Each is an attempt to answer "what did this used to be, and
why?" — a question version control already answers exactly, with authorship and timestamps that
cannot drift.

The shadow history is worse than useless for an AI-native codebase specifically. It costs context
window on every read, it is indistinguishable from live code to a reader working from a snippet, and
it rots without failing: nothing checks that a comment about the old behaviour still describes the
old behaviour. Agents are especially prone to reviving commented-out code because it looks endorsed.

## Decision

**Git is the record of how the code got here. The working tree describes only what is true now.**

Not allowed in source or live docs:

- Commented-out code. Delete it.
- Comments narrating change: "was X", "used to", "changed on <date>", "TODO from the refactor",
  "keeping for reference".
- Changelogs, version tables, or migration histories embedded in source files or live docs.
- Attribution comments naming who wrote or requested something.

Comments are for the non-obvious **why** of code that exists: an invariant a reader would otherwise
violate, a workaround for a specific external bug, a constraint that explains a counter-intuitive
choice. If a comment explains _what_ the code does, the code should be clearer instead.

Because git now carries the load, commits must carry real content
([../../CONTRIBUTING.md](../../CONTRIBUTING.md)): the body explains why the change was made, what
was rejected, and what was not verified. Durable reasoning that outlives a single change graduates
to an ADR or a spec, where it is findable without archaeology.

Docs are held to the same rule. A live doc states the current design. Superseded designs live in
superseded ADRs and in `docs/legacy/`, not in a "History" section.

## Alternatives considered

| Alternative                                         | Why not                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Allow commented-out code behind a marker convention | Markers rot too, and a reader with a snippet has no way to tell endorsed code from a dead branch.                                                       |
| Keep a `CHANGELOG.md`                               | Duplicates git for an audience that does not exist yet. Reconsider when there are external consumers who need release notes.                            |
| Rely on review to catch it                          | Review is the slowest, least reliable enforcement point, and much of the review here is done by agents that were trained on repos full of exactly this. |

## Consequences

- Easier: files read as a statement of the present; context spent on a file is spent on live code;
  `git log`/`git blame` become the one place to ask historical questions.
- Harder: commit messages and ADRs have to be genuinely good, because they are now the only record.
  A lazy `fix stuff` commit destroys information permanently.
- Accepted cost: recovering a deleted approach takes a git operation rather than uncommenting. That
  is the intended trade.
- Not yet enforced mechanically. When a language is chosen, a lint rule against commented-out code
  and change-narrating comments should be part of that stack's ADR — until then this is a review
  rule, which is explicitly the weaker form.
- Revisit if: the repo gains external consumers who need release notes, which would justify a
  generated (not hand-maintained) changelog.

## Audit surface

Git history is the audit surface for the repository itself: every change attributable to an author
and a message, and no rewriting of published history. Force-pushing a shared branch destroys that
record and is not done.
