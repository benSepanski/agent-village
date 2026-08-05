# @agent-village/agent-environment

Implementation of [spec 0002](../../docs/specs/0002-agent-environment/spec.md): sandboxed
environments with no raw network, joined by directional bridges that terminate a typed protocol,
decide, perform, and record. The spec's terminology is binding here — start there, not here.

| You want to                       | Go to                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| See what is built so far          | [milestones](../../docs/specs/0002-agent-environment/milestones/README.md)                 |
| Understand the stack choice       | [ADR-0004](../../docs/adr/0004-typescript-node-stack.md)                                   |
| Run the checks                    | `pnpm typecheck && pnpm lint && pnpm test` (no Docker needed)                              |
| Run the M1 walking-skeleton proof | `pnpm fixture:m1` (needs a Docker daemon; prints per-criterion PASS/FAIL and journal path) |
| Run the M2 checker proof          | `pnpm fixture:m2` (no Docker needed — rejection happens before anything runs)              |
