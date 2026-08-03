# Scratch notes

Working memory between sessions. The context one session wants to hand the next that does not belong
in a spec, an ADR, a dev doc, or a commit message.

Written for agents. State facts, cite paths, do not hedge for an audience.

## What goes here

- **Session handoffs** — where work stopped, what is half-done, what to check first.
- **Investigation logs** — how something was tracked down, what was ruled out and why.
- **Half-formed thinking** — the reasoning behind an in-flight approach, before it is settled enough
  to be an ADR.
- **Deferred observations** — real things noticed while doing something else, which would have been
  scope creep to chase.

## What does not

| Not this                               | Goes to                                  |
| -------------------------------------- | ---------------------------------------- |
| Anything load-bearing about the system | a [spec](../specs/) or an [ADR](../adr/) |
| How to use or run the repo             | [../dev/](../dev/)                       |
| A decision                             | [../adr/](../adr/)                       |
| Why a change was made                  | the commit message                       |
| Secrets, tokens, credentials           | nowhere in this repo                     |

## Rules

- **Never load-bearing.** Nothing here is a source of truth, and no doc, spec, or code comment
  should depend on a note. If a fact matters, promote it and delete the note.
- **Point-in-time.** A note describes what was true when it was written. Verify its file and line
  claims against the current tree before trusting them.
- **Prune aggressively.** When you act on a note, delete or update it. When a note's fact has been
  promoted, delete it. Stale scratch is worse than no scratch, because it is read with the same
  trust as fresh scratch.
- **One file per topic or session**: `YYYY-MM-DD-kebab-topic.md`. Open with a one-line summary and
  the date; close with what is unresolved.
