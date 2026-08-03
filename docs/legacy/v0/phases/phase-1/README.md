# Phase 1 — Step-by-step

Each step is a self-contained ~1-screen brief. Execute in order; after each step, `pnpm lint && pnpm typecheck && pnpm test` must stay green.

| #   | Step                                                  | Touches             |
| --- | ----------------------------------------------------- | ------------------- |
| 1   | [Schemas](01-schemas.md)                              | `packages/shared`   |
| 2   | [Data repositories](02-data-repos.md)                 | `packages/data`     |
| 3   | [Secrets adapter](03-secrets.md)                      | `packages/data`     |
| 4   | [Domain helpers](04-domain.md)                        | `packages/domain`   |
| 5   | [Services (use cases)](05-services.md)                | `packages/services` |
| 6   | [Infra wiring](06-infra.md)                           | `packages/infra`    |
| 7   | [API handlers](07-api-handlers.md)                    | `packages/api`      |
| 8   | [Runner handler](08-runner.md)                        | `packages/runner`   |
| 9   | [CLI](09-cli.md)                                      | `packages/cli`      |
| 10  | [Web — auth](10-web-auth.md)                          | `packages/web`      |
| 11  | [Web — agent CRUD UI](11-web-agent-ui.md)             | `packages/web`      |
| 12  | [Web — run viewer + scratchpad](12-web-run-viewer.md) | `packages/web`      |
| 13  | [Alarms](13-alarms.md)                                | `packages/infra`    |
| 14  | [E2E](14-e2e.md)                                      | `packages/web/e2e`  |

See [phase-1-mvp.md](../phase-1-mvp.md) for the dependency graph between steps and the full definition of done.
