# ADR 0004: TypeScript on Node for the agent-environment implementation

Date: 2026-08-04
Status: Proposed
Driver: [spec 0002, milestone M1](../specs/0002-agent-environment/milestones/M1-walking-skeleton.md)

## Context

M1 of spec 0002 requires picking the implementation language and runtime stack before writing code,
because it constrains every later milestone. The workload is orchestration and record-keeping:
driving the Docker runtime, terminating typed protocols on Unix sockets, validating declarations at
boundaries, and appending journal events. Nothing in the spec is compute-bound.

Constraints that are facts: the repository harness is already Node (`scripts/`, zero dependencies),
pinned to Node 22 by `.nvmrc`, with pnpm and Prettier in place. The environment runtime's probe and
harness code must run _inside_ containers, so a language whose artifacts run unmodified on a stock
container image avoids building and maintaining custom images in early milestones. The codebase is
written and reviewed largely by agents, so mechanical enforcement of correctness rules is worth
more than expressive power ([design-principles](../dev/design-principles.md)).

An assumption, stated: the owner's v0 codebase was a TypeScript monorepo, so TypeScript conventions
are familiar territory for review.

## Decision

TypeScript, strict mode, compiled with `tsc`, running on Node 22. Package management with pnpm
workspaces; the first package is `packages/agent-environment`. Tests use the built-in `node:test`
runner. Linting uses ESLint with typescript-eslint's type-checked recommended rules. Runtime
dependencies require justification in a spec or ADR before adoption; the starting set is empty —
Docker is driven through its CLI, sockets and JSON through the standard library.

Of the [dev README](../dev/README.md)'s review-rule conventions, the ones that become mechanical
now: unused code, floating promises (`@typescript-eslint/no-floating-promises` — a dropped promise
on a journal write is a silently lost audit record, which ADR-0003 forbids), and strict typing at
boundaries. "No commented-out code" and "every component states its audit surface" remain review
rules: no off-the-shelf lint rule detects either reliably, and a flaky check teaches people to
ignore red.

## Alternatives considered

| Alternative | Why not                                                                                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go          | Strong Docker ecosystem and static binaries, but a second toolchain beside the Node docs harness, and in-container components would need cross-compiled binaries baked into images |
| Rust        | Best-in-class correctness, but slowest iteration for agent-driven development, and the workload has no performance case for it                                                     |
| Python      | Fine for orchestration, but adds a second ecosystem, and its type checking is advisory rather than enforced at build time                                                          |
| Bun/Deno    | Fewer moving parts than Node in places, but Node 22 is already the repo's pinned runtime and the runtimes' Docker/socket edges are less proven                                     |

## Consequences

Easier: one toolchain across harness and product; in-container code runs as plain JS on stock
`node:22` images; agents get type errors and lint errors as red checks instead of review comments.

Harder: CPU-bound work, if any milestone ever has it, will need a subprocess or a rethink; `tsc`
build output (`dist/`) is an artifact step every run path must account for.

Accepted cost: ESLint and TypeScript are development-time dependencies with real supply-chain
surface. They do not ship into environments.

Revisit trigger: a milestone that needs kernel-adjacent work (namespaces, seccomp, snapshot
filesystems) that Node cannot express, or a measured fixture where protocol termination in Node
adds latency that breaks an acceptance criterion.

## Audit surface

None directly — this decision produces no runtime events. It constrains how audit records are
produced: journal writes are typed, and the floating-promise lint makes "event emitted but never
awaited" a build failure rather than a data-loss discovery
([ADR-0003](0003-auditability-is-a-requirement.md)).
