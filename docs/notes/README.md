# Agent notes

A scratch space for **generic agent/AI working notes** — the context a session
wants to hand the next one that doesn't belong in code, a test, an ADR, or a
phase doc. Session handoffs, investigation logs, "here's what I tried and why,"
dead ends worth remembering. Informal and prunable by design.

## What goes here

- **Session handoffs** — where a piece of work stopped, what's half-done, what
  to check first next time.
- **Investigation logs** — how a bug was tracked down, what was ruled out.
- **Working context** — the non-obvious "why" behind an in-flight approach,
  before it's settled enough for an ADR.

## What does NOT go here

- **Load-bearing facts about the system** — those go in code, a Zod schema, a
  test, an [ADR](../adr/README.md), or a `docs/` page. Notes are context, not a
  source of truth; the harness never trusts a note.
- **Future direction / goals** — that's the [roadmap](../roadmap.md).
- **Ordered plans of work** — that's [`phases/`](../phases/README.md).
- **Secrets, tokens, or anything you wouldn't commit.**

## Conventions

- One file per topic or session: `YYYY-MM-DD-kebab-topic.md` (e.g.
  `2026-07-08-phase3-review-handoff.md`).
- Start with a one-line summary and the date. Sign off with what's unresolved.
- **Prune aggressively.** A note that's been superseded or whose fact has been
  promoted into code/ADR/docs should be deleted — stale notes mislead. When you
  act on a note, delete or update it.
- These are point-in-time observations; verify against current code before
  trusting a note's file/line claims.
