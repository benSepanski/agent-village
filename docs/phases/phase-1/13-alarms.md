# Phase 1, Step 13 — Alarms

Wire CloudWatch alarms in `MonitoringStack` and confirm the SNS topic delivers email.

## Alarms to add

| Alarm             | Condition                                        | Action                  |
| ----------------- | ------------------------------------------------ | ----------------------- |
| `runner-errors`   | `runs.error` metric > 0 over 5 min               | Publish to `alarmTopic` |
| `spend-rejected`  | `runs.spend_limit_exceeded` metric ≥ 1 in 1 hour | Publish to `alarmTopic` |
| `runner-duration` | Runner Lambda p95 > 30 seconds                   | Publish to `alarmTopic` |

The Lambda `error` metric (built-in CloudWatch) for the runner function is also wired with a separate alarm — independent of the EMF-based `runs.error` since transient invocation failures can occur without producing structured logs.

## Files to modify

- [`packages/infra/src/stacks/monitoring-stack.ts`](../../../packages/infra/src/stacks/monitoring-stack.ts) — add `Metric` + `Alarm` constructs, point them at the `RunnerStack` Lambda. Cross-stack reference via stack output.

## Acceptance

- Deploy to dev; manually invoke the runner with a known-bad agent (e.g. invalid Anthropic key); receive an alarm email within ~5 minutes.
- AWS Budgets alarm at 50% — verify by setting `monthlyBudgetUsd` to $0.10 temporarily (then revert).
- `pnpm --filter @agent-village/infra synth:prod` clean.

## Reference

- [observability](../../architecture/observability.md)
- [cost-guards](../../architecture/cost-guards.md)
