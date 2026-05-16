# Architecture

## Runtime topology

```
                    ┌────────────┐
                    │  Browser   │
                    └──────┬─────┘
                           │ HTTPS
                  ┌────────▼────────┐
                  │  CloudFront     │
                  └──┬──────────┬───┘
              static │          │ /api/*  (Cognito JWT)
                ┌────▼───┐   ┌──▼──────────────┐
                │   S3   │   │  API Gateway     │
                └────────┘   │  HTTP API        │
                             └──┬───────────────┘
                                │
                          ┌─────▼──────────────┐
                          │  Lambda (api)      │
                          └──┬──────┬──────────┘
                             │      │
                             │      └──▶ Secrets Manager
                             ▼
                       ┌───────────┐
                       │ DynamoDB  │◀──── Lambda (runner)
                       └───────────┘             ▲
                                                 │
                              EventBridge Scheduler (per-agent cron)
                                                 │
                                          ┌──────┴──────┐
                                          │  Anthropic  │
                                          └─────────────┘
```

## Layered package graph

The graph is enforced mechanically by `dependency-cruiser` (see `.dependency-cruiser.cjs`).
A PR that violates an edge fails CI with a self-correcting error message.

```
shared ◀── domain ◀── data ◀── services ◀── api
                                       ◀── runner
                                       ◀── cli
shared ◀── web
shared ◀── infra
```

Allowed imports:

| Package    | May import from            |
| ---------- | -------------------------- |
| `shared`   | (none — leaf)              |
| `domain`   | `shared`                   |
| `data`     | `shared`, `domain`         |
| `services` | `shared`, `domain`, `data` |
| `api`      | `shared`, `services`       |
| `runner`   | `shared`, `services`       |
| `cli`      | `shared`, `services`       |
| `web`      | `shared`                   |
| `infra`    | `shared`                   |

## Environments

Three logical environments:

- **local** — docker-compose runs LocalStack + DynamoDB Local. No AWS account needed.
- **dev** — full AWS deploy. Auto-deployed on every push to `main`.
- **prod** — full AWS deploy. Deployed only on tagged release (`v*`) with a manual approval gate.

`dev` and `prod` share the same CDK code; only [`packages/infra/config/`](../packages/infra/config/) differs.

## Cost guards

- AWS Budget per env with 50/80/100% email alarms (see `MonitoringStack`).
- Per-agent spend ceiling enforced atomically via DynamoDB conditional `UpdateItem` (Phase 1.4).
- DynamoDB pay-per-request mode — no idle capacity to forget about.
- CloudWatch Logs retention 7d dev, 30d prod.
- Lambda memory tuned per env (256 MB dev runner, 512 MB prod runner).

## Observability

See [`docs/conventions.md`](conventions.md) for the structured-logging contract.

- **Logs:** `pino` JSON with closed-enum `event` envelope; pretty-printed locally.
- **Traces:** AWS Lambda Powertools + X-Ray; `traceId` flows from API → handler → DDB → Anthropic
  and is persisted on the Run record.
- **Metrics:** CloudWatch EMF emitted via the logger's `metric` payload key.
- **In-app dashboard:** the web UI is itself the primary observability surface — see Phase 1.5.
