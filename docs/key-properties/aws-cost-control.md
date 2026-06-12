# Key property: cost control

**The property:** a runaway agent, bug, or forgotten environment cannot spend more than a bounded, known amount — per agent for Anthropic spend, per month (with alerts) for AWS spend.

There are two distinct cost surfaces with different enforcement strength: **Anthropic spend is hard-capped in code**; **AWS spend is alerted on, not blocked**.

## Anthropic spend — hard cap, enforced atomically

| Mechanism                                                                                                                                                                                                                        | Code                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every agent carries `spendLimitUsd` (cap) and `spendUsedUsd` (accumulator); both are required by the schema                                                                                                                      | [`AgentSchema`](../../packages/shared/src/schemas/agent.ts)                                                                                                                       |
| Before any Anthropic call, the worst-case cost is estimated from the model's price table and the `max_tokens` ceiling (1024, or 256 for dry runs)                                                                                | [`estimateCost()` in `cost.ts`](../../packages/domain/src/cost.ts), constants in [`runner.ts`](../../packages/services/src/runner.ts)                                             |
| The estimate is reserved with an atomic DynamoDB `UpdateItem` whose `ConditionExpression` is `spendUsedUsd + :estimate <= spendLimitUsd`. A failed condition throws `SpendLimitExceededError` — the Anthropic call never happens | [`reserveSpend()` in `agents.ts`](../../packages/data/src/dynamo/agents.ts)                                                                                                       |
| A rejected reservation is persisted as a Run with `status=spend_limit_exceeded` and emits the `runs.spend_limit_exceeded` metric, which has a CloudWatch alarm                                                                   | [`appendRejected()` in `runner.ts`](../../packages/services/src/runner.ts), [`buildSpendAlarm()` in `monitoring-stack.ts`](../../packages/infra/src/stacks/monitoring-stack.ts)   |
| After the call, the accumulator is corrected from estimate to actual usage; if anything fails before finalization, the reservation is refunded                                                                                   | [`executeReserved()` / `refundReservation()` in `runner.ts`](../../packages/services/src/runner.ts), [`finalizeSpend()` in `agents.ts`](../../packages/data/src/dynamo/agents.ts) |

Full write-sequence detail: [spend-reservation](../data-model/spend-reservation.md).

## AWS spend — alerts plus structural caps

| Mechanism                                                                                                                               | Code                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AWS Budget per environment ($5 dev / $20 prod) emails `alarmEmail` at 50/80/100% of the cap. **Alert only — it does not stop spending** | [`buildBudget()` in `monitoring-stack.ts`](../../packages/infra/src/stacks/monitoring-stack.ts), caps in [`config/dev.ts`](../../packages/infra/config/dev.ts) / [`prod.ts`](../../packages/infra/config/prod.ts) |
| DynamoDB pay-per-request billing — zero idle capacity cost                                                                              | [`data-stack.ts`](../../packages/infra/src/stacks/data-stack.ts)                                                                                                                                                  |
| No NAT gateway anywhere; the sandbox VPC uses public subnets with `natGateways: 0` (a NAT gateway alone is ~$32/mo idle)                | [`buildCluster()` in `sandbox-stack.ts`](../../packages/infra/src/stacks/sandbox-stack.ts)                                                                                                                        |
| Lambda memory and Fargate task CPU/memory are fixed per env in typed config                                                             | [`config/types.ts`](../../packages/infra/config/types.ts)                                                                                                                                                         |
| CloudWatch Logs retention is 7 d dev / 30 d prod, so log storage cannot grow unboundedly                                                | `logRetentionDays` in [`config/dev.ts`](../../packages/infra/config/dev.ts), applied via [`log-retention.ts`](../../packages/infra/src/stacks/log-retention.ts)                                                   |
| Workspace-bucket noncurrent versions expire after 30 d dev / 90 d prod; the ECR repo keeps at most 10 images                            | lifecycle rules in [`sandbox-stack.ts`](../../packages/infra/src/stacks/sandbox-stack.ts)                                                                                                                         |

Operational guidance (where to look in the console, how to tear down a forgotten env): [cost-guards](../architecture/cost-guards.md).

## Known limits

- **The AWS Budget does not stop spending.** It is a notification. A bug that loops Lambda invocations is bounded only by the alarm email and your reaction time.
- **No per-user aggregate cap.** Each agent has its own `spendLimitUsd`; nothing caps the sum across agents.
- **`spendUsedUsd` never resets automatically.** The cap is effectively lifetime-per-agent until the limit is raised or the accumulator is manually reset. There is no reconciliation cron.
- **No per-agent concurrency guard on the inline run path** — see [concurrent-state-access](concurrent-state-access.md). The atomic reservation still prevents the cap from being exceeded.
