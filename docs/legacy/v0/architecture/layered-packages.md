# Layered packages

Each `packages/*` directory has one job, and the dependency direction is enforced mechanically by `dependency-cruiser` ([`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs)). Any other edge fails CI with a self-correcting message.

## Allowed edges

```
shared ◀── domain ◀── data ◀── services ◀── api
                                       ◀── runner
                                       ◀── cli
shared ◀── web
shared ◀── infra
```

## What each package is for

| Package    | Purpose                                       | May import from            |
| ---------- | --------------------------------------------- | -------------------------- |
| `shared`   | Zod schemas, types, log-event enum, constants | (none — leaf)              |
| `domain`   | Pure business logic, no I/O                   | `shared`                   |
| `data`     | DynamoDB + Secrets Manager repositories       | `shared`, `domain`         |
| `services` | Use-cases / orchestration                     | `shared`, `domain`, `data` |
| `api`      | API Gateway Lambda handlers                   | `shared`, `services`       |
| `runner`   | Scheduled / event-driven Lambda handlers      | `shared`, `services`       |
| `cli`      | `village` CLI commands                        | `shared`, `services`       |
| `web`      | Vite + React SPA (runs in browser)            | `shared`                   |
| `infra`    | AWS CDK app (deploys everything)              | `shared`                   |

## Why these directions

- `shared` being a leaf means anything truly cross-cutting lives there once.
- `domain` having no I/O makes it trivially testable; the rules of the system don't move when storage does.
- `services` is the only place that orchestrates I/O — handlers (`api`, `runner`, `cli`) must call into `services`, never reach past it.
- `web` can't depend on server packages because they wouldn't ship to the browser anyway; everything it needs must go through HTTP.
- `infra` only consumes `shared` constants/schemas — the IaC is not a place for app logic.

## Verifying

```bash
pnpm deps:check
```

prints any forbidden edge with a prescriptive message explaining the rule that fired.
