# Design principles

Three goals drive this project: **AI-native**, **modular**, **simple**. Stated that way they are
slogans. This page says what each one costs you in practice, so a design review can actually apply
them.

## AI-native

The codebase is meant to be read, changed, and reviewed largely by agents — with a human setting the
bar rather than reading every line. That is a real constraint, not a style preference.

An agent arrives with no memory, a bounded context window, and a strong prior toward whatever it saw
in training. So:

- **Enforce, don't instruct.** A rule that lives only in prose gets followed most of the time, which
  is the worst possible failure rate: frequent enough to look fine, rare enough to break silently.
  If a rule matters, something must turn red when it is violated. If it cannot be checked, call it
  guidance and stop treating it as a rule.
- **Optimize for cold reads.** Every file should make sense to someone who has read nothing else.
  Small files, explicit imports, names that survive being quoted out of context, no "see the pattern
  in the other module".
- **Bounded context is a budget.** A 1000-line instruction file spends the budget before the task
  starts. Hence one-question docs and pointer-style indexes ([doc-system.md](doc-system.md)).
- **Contracts at boundaries, freedom inside.** Validate and type what crosses a boundary; leave the
  interior to whatever is clearest. The point is trustworthy interfaces, not micromanaged style.
- **No tribal knowledge.** A fact that lives only in a chat log or someone's head does not exist for
  the next session and will be violated. Write it where it belongs.
- **The present tense only.** Source describes what is true now; git describes how it got there
  ([ADR-0002](../adr/0002-history-over-commentary.md)).

The test: could a fresh agent, given one file and its links, make a correct change — and would the
harness catch it if it did not?

## Modularity

A component is modular when it can be replaced without archaeology. That requires three things
written down, and this is exactly what the spec template asks for:

1. **A contract** — what it accepts, what it returns, what it promises, what it assumes.
2. **A trust boundary** — what it validates, what it refuses, what it will never be told.
3. **An audit surface** — what it records about what it did
   ([ADR-0003](../adr/0003-auditability-is-a-requirement.md)).

A component with all three can be reimplemented against its contract. One missing any of them can
only be understood by reading it, which means it can only be replaced by rewriting its neighbours.

Two consequences worth stating:

- **Runtimes are pluggable, defaults are opinionated.** Docker is the expected first implementation
  of the environment runtime, not the definition of it. Same shape elsewhere: a general interface, a
  good off-the-shelf implementation, no assumption that yours is the only one.
- **Modularity is not layering.** Do not invent packages for tidiness. A boundary earns its
  existence by being a real contract someone might implement differently — otherwise it is overhead
  charged on every change.

## Simplicity

The fewest moving parts that satisfy the spec. In practice this is mostly about saying no:

- **Every dependency is a liability** — supply chain, upgrades, and a shape you now design around.
  New dependencies are justified in the spec or an ADR, not slipped in with a feature.
- **Build for the spec in front of you**, not the one you imagine next. Speculative generality is
  the most expensive kind of complexity because it looks like foresight.
- **Prefer boring, inspectable mechanisms.** A file you can read beats a clever abstraction you have
  to run to understand — especially for agents, which cannot run most things while reading.
- **Delete aggressively.** Dead code and stale docs cost context on every read. Git remembers.
- **Fewest concepts wins.** If two mechanisms do nearly the same thing, that is a design smell.
  Terminology in a spec is binding partly to prevent this.

## When they conflict

They do conflict — an enforced rule adds machinery, a clean boundary adds indirection.

The order is **simplicity → AI-native → modularity**, and the reasoning is asymmetric risk. A simple
system that turns out to need a boundary can grow one; a complex system rarely gets simplified.
Enforcement beats modularity because an unenforced convention decays into a false claim, while a
missing boundary is merely inconvenient.

The exception: **auditability and trust boundaries are not traded away for simplicity.** They are
requirements ([ADR-0003](../adr/0003-auditability-is-a-requirement.md)). A simpler design that
cannot say what happened is not simpler, it is unfinished.

Record a conflict you resolved in an ADR. Whichever way it went, the next reader will hit the same
tension.
