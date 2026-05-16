# Observability

You should be able to answer "what is this agent doing and why?" without opening the AWS console.

## Logging

- Single shared logger ([`packages/shared/src/observability/logger.ts`](../../packages/shared/src/observability/logger.ts)) built on `pino`.
- JSON in deployed envs; pretty-printed in local dev.
- Every log call uses the structured envelope — see [structured-logging](../conventions/structured-logging.md).

## Tracing

- AWS Lambda Powertools' `Tracer` (X-Ray) enabled on every Lambda. Free tier: 100k traces/mo.
- A single `traceId` flows from API Gateway → Lambda → DynamoDB → Anthropic.
- The `traceId` is persisted on the Run record so the UI can deep-link to it.

## Metrics

- CloudWatch EMF emitted via the logger's `metric: {...}` payload key — no extra SDK call needed.
- Standard metrics: `runs.started`, `runs.ok`, `runs.error`, `runs.spend_limit_exceeded`, `anthropic.latency_ms`, `anthropic.cost_usd`.

## Alarms

Defined in [`MonitoringStack`](../../packages/infra/src/stacks/monitoring-stack.ts):

- Runner Lambda `error` metric > 0 over 5 min.
- `spend_limit_exceeded` ≥ 1 in 1h.
- Runner duration p95 > 30s.
- AWS Budgets at 50/80/100% of monthly cap.

All alarms publish to an SNS topic subscribed by the env's `alarmEmail`.

## In-app surface

The web UI is the primary observability dashboard for daily use:

- **Agent detail page** — last 50 runs with status / duration / cost.
- **Run detail page** — per-step timeline derived from the structured log events for the run's `traceId`. Token + cost breakdown. Deep-link to CloudWatch Logs Insights.
- **System health page** (`/health`) — account spend vs Budget, error counts, last successful deploy, active-agent count.

## When you need more

`docs/playbooks/` includes "trace a failing run" — TODO Phase 1.
