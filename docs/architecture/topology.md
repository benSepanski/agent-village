# Topology

Two request paths: browser-driven (the UI) and time-driven (the scheduled runner).

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

Every request to the API carries a Cognito JWT verified by the API Gateway JWT authorizer.

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

The runner is also invoked synchronously by `POST /agents/:id/run-now` from the API — same code path, just a different trigger.

## Key invariants

- The runner never holds API keys in memory across invocations.
- Spend reservation is atomic via DynamoDB `ConditionExpression` (see [spend-reservation](../data-model/spend-reservation.md)).
- All structured logs from a given request/run share one `traceId` that's also persisted on the Run record.
