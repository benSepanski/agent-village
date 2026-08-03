# Legacy documentation

**Nothing in this directory is authoritative.** It describes systems that no longer exist. It is
kept because the reasoning is sometimes still useful, not because the conclusions still hold.

| Version                | What it was                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| [v0/](v0/)             | A personal AWS-hosted scheduler for autonomous agents: TypeScript monorepo, CDK, DynamoDB single-table, Cognito auth, Fargate sandbox runs with an egress-proxy sidecar and a metered Anthropic gateway. Shipped and dogfooded; scrapped in favour of the redesign in [../specs/](../specs/). |

## Rules

- **Frozen.** Never edit a file under a version directory. If something in here is wrong, that is
  fine — it is history, and history is not maintained.
- **Not linked from live docs.** Live docs must not depend on legacy pages to explain themselves. A
  one-off reference for archaeology (like this page) is the exception.
- **Excluded from the harness.** `pnpm check:links` and Prettier skip this tree; its links have
  rotted by design.
- **Fair game to mine.** If a legacy doc contains a principle worth keeping, restate it in a live
  doc or an ADR. Do not link to it and call it done.

## Why v0 was scrapped

v0 solved the problem it was scoped to — scheduling one person's agents on AWS — by growing an
application-shaped platform: nine layered packages, per-agent scheduling and spend accounting, a
web UI. The redesign targets a different, more general problem (sandboxed capabilities, mountable
agent filesystems, bridges as the only egress) under different goals, and reusing v0's structure
would have imported an architecture chosen for the old problem. See
[ADR-0001](../adr/0001-docs-first-spec-driven-reset.md).

The most durable part of v0 is its writing about how an agent-legible repo should be built:
`v0/conventions/harness-engineering.md`, `v0/conventions/comments.md`, and `v0/adr/`. Those ideas
live on in [../dev/design-principles.md](../dev/design-principles.md) and [../adr/](../adr/).
