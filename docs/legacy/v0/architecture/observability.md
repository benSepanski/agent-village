# Observability

You should be able to answer "what is this agent doing and why?" without opening the AWS console.

## Logging

- Single shared logger ([`packages/shared/src/observability/logger.ts`](../../packages/shared/src/observability/logger.ts)) built on `pino`.
- JSON in deployed envs; pretty-printed in local dev.
- Every log call uses the structured envelope — see [structured-logging](../conventions/structured-logging.md).

## Tracing

- Every API request and run carries a `traceId`: the API middleware reads the `x-amzn-trace-id` header ([`middleware.ts`](../../packages/api/src/middleware.ts)); the runner reads Lambda's `_X_AMZN_TRACE_ID` env var ([`runner.ts`](../../packages/services/src/runner.ts)).
- The `traceId` appears on every structured log line for that request/run and is persisted on the Run record, so CloudWatch Logs Insights can reconstruct any run end-to-end with one filter.
- X-Ray active tracing is not enabled; the trace id is used for log correlation only.

## Metrics

- Log calls may carry a `metric: { name: value }` payload key (e.g. `spend.reserved_usd`, `run.cost_usd`, `run.duration_ms` in [`runner.ts`](../../packages/services/src/runner.ts)). The values are queryable via Logs Insights.
- Terminal run outcomes emit the CloudWatch EMF envelope via [`runOutcomeMetric`](../../packages/shared/src/observability/emf.ts), so the custom-namespace alarms below are active.

## Alarms

Defined in [`MonitoringStack`](../../packages/infra/src/stacks/monitoring-stack.ts):

- Runner Lambda errors > 0 over 5 min (native Lambda metric — active).
- Runner duration p95 > 30 s over two 5-min periods (native — active).
- `runs.error` > 0 over 5 min and `runs.spend_limit_exceeded` > 0 over 1 h (custom `AgentVillage` namespace — active, see above).
- AWS Budget emails at 50/80/100% of the monthly cap.

All alarms publish to an SNS topic subscribed by the env's `alarmEmail`.

## In-app surface

The web UI is the primary observability dashboard for daily use:

- **Agent detail page** — last 50 runs ([`runs.ts` default limit](../../packages/data/src/dynamo/runs.ts)) with status / duration / cost, plus the spend bar.
- **Run detail page** — token + cost breakdown, output/error, a step timeline reconstructed from the run record ([`RunTimeline.tsx`](../../packages/web/src/components/RunTimeline.tsx)), and a CloudWatch Logs Insights deep link for the run's `traceId`.
- **System health page** (`/health`) — active/paused agent counts and aggregate spend used vs. limits across agents ([`SystemHealth.tsx`](../../packages/web/src/components/SystemHealth.tsx)).
