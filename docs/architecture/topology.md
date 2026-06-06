# Topology

Two request paths: browser-driven (the UI) and time-driven (the
scheduled runner).

## The AWS services in one line each

| Service                 | Role here                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| **CloudFront**          | AWS's CDN. Caches and serves the SPA worldwide over HTTPS.                                 |
| **S3**                  | Object storage. Holds the built SPA bundle (`index.html` + JS/CSS).                        |
| **API Gateway (HTTP API)** | The public HTTPS front door for the API. Verifies the Cognito JWT on every request.    |
| **Lambda (api)**        | Per-route serverless functions. One Lambda per API handler.                                |
| **Lambda (runner)**     | Serverless function that runs an agent — invoked by the scheduler or by `run-now`.         |
| **DynamoDB**            | Serverless key-value database. Stores users, agents, and runs.                             |
| **Secrets Manager**     | Encrypted secret storage. One secret per agent, holding that agent's Anthropic API key.    |
| **EventBridge Scheduler** | AWS's cron-as-a-service. One schedule per agent, invoking the runner Lambda.             |
| **Cognito**             | Managed user pool + auth. Issues JWTs the API Gateway verifies.                            |
| **CloudWatch**          | Logs, metrics, alarms.                                                                     |
| **SNS**                 | Pub/sub. The alarm topic that emails you when something breaks.                            |

## Browser path

```
[browser] ──HTTPS──▶ CloudFront ──▶ S3                (static SPA bundle)
                          │
                          └─▶ API Gateway HTTP API ──▶ Lambda(api)
                                                          │
                                                          ├─▶ DynamoDB
                                                          ├─▶ Secrets Manager
                                                          └─▶ EventBridge Scheduler
                                                              (when schedule changes)
```

Every request to the API carries a Cognito JWT verified by the API
Gateway JWT authorizer.

## Scheduled path

```
EventBridge Scheduler (per-agent cron)
        │
        ▼
   Lambda(runner)
        │
        ├─▶ DynamoDB           (load agent, atomic spend reservation, write run)
        ├─▶ Secrets Manager    (fetch agent's Anthropic API key)
        └─▶ Anthropic API      (LLM call)
```

The runner is also invoked synchronously by `POST /agents/:id/run-now`
from the API — same code path, just a different trigger.

## Key invariants

- The runner never holds API keys in memory across invocations.
- Spend reservation is atomic via DynamoDB `ConditionExpression` (see
  [spend-reservation](../data-model/spend-reservation.md)).
- All structured logs from a given request/run share one `traceId`
  that's also persisted on the Run record.
