# Naming

| Thing                        | Style                                        | Example                    |
| ---------------------------- | -------------------------------------------- | -------------------------- |
| File name                    | `kebab-case.ts`                              | `agent-runner.ts`          |
| Directory                    | `kebab-case`                                 | `data-model/`              |
| Class                        | `PascalCase`                                 | `DataStack`                |
| Interface / Type             | `PascalCase`                                 | `EnvConfig`                |
| Function / Variable          | `camelCase`                                  | `loadEnvConfig`, `agentId` |
| Constant (top-level, frozen) | `SCREAMING_SNAKE_CASE`                       | `LOG_EVENTS`               |
| Test file                    | `<name>.test.ts` next to the file under test | `logger.test.ts`           |
| Structured-log event         | `<noun>.<action>`                            | `agent.run.started`        |
| DynamoDB key prefix          | `<ENTITY>#<id>`                              | `AGENT#abc123`             |

## One default export → file name matches

When a module has a single primary export (a class, a React component, a CDK construct), the file name matches the export's kebab-case:

```
DataStack          → data-stack.ts
createLogger       → logger.ts (one of several exports)
```

## CDK stack names

`<prefix>-<purpose>` where `<prefix>` is the env-scoped resource prefix (e.g. `agent-village-dev-data`). Set automatically in [`bin/app.ts`](../../packages/infra/bin/app.ts).
