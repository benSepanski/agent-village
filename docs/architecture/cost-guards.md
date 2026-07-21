# Cost guards

Two layers of cost protection: AWS account-level (catches everything),
and per-agent application-level (catches Anthropic spend specifically).
Mechanism-by-mechanism code links:
[key-properties/aws-cost-control](../key-properties/aws-cost-control.md).

## Account-level (defined in CDK)

These all live in
[`MonitoringStack`](../../packages/infra/src/stacks/monitoring-stack.ts)
and the per-env config in
[`packages/infra/config/`](../../packages/infra/config/).

| Guard                           | What it does                                                                                                                                                                                                                         | Defaults                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| **AWS Budgets**                 | AWS-managed spend tracker. Emails the address in `alarmEmail` when your month-to-date spend crosses a threshold. Doesn't _stop_ spending — it only alerts.                                                                           | $5 dev, $20 prod, alerts at 50/80/100% |
| **CloudWatch Logs retention**   | Deletes log events older than N days. AWS's default is "keep forever", which grows the bill silently; every log group here sets explicit retention.                                                                                  | 7d dev, 30d prod                       |
| **DynamoDB pay-per-request**    | Billing per request instead of reserved capacity 24/7. No idle cost.                                                                                                                                                                 | Always on                              |
| **No NAT Gateway**              | A NAT Gateway costs ~$32/mo idle. The serverless services run outside any VPC; the sandbox Fargate cluster's VPC uses public subnets with `natGateways: 0` ([`sandbox-stack.ts`](../../packages/infra/src/stacks/sandbox-stack.ts)). | Always on                              |
| **Lambda memory tuned per env** | Lambda is billed per GB-second. Lower memory = cheaper but slower cold starts. Prod gets more memory for the runner so user-visible latency stays low.                                                                               | 256 MB dev, up to 512 MB prod          |

### How to check your current spend

| You want to know...                | Where to look                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| Month-to-date spend, broken down   | AWS Console → **Billing → Bills** (current month) or **Cost Explorer** (graph) |
| Where you stand against the budget | AWS Console → **Billing → Budgets** → `agent-village-<env>-monthly`            |
| Did an alarm fire?                 | AWS Console → **CloudWatch → Alarms**                                          |
| Got an email from `no-reply@sns…`? | That's a real alarm. Read [observability](observability.md#alarms).            |

For new AWS accounts, the Free Tier dashboard
(**Billing → Free Tier**) is also worth a glance — it shows what you've
consumed of each free-tier allowance for the month.

## Per-agent (defined in application code)

The cost AWS Budgets _won't_ catch is Anthropic API spend — Anthropic
bills directly, not through AWS. It is capped in code:

- Each Agent record has `spendLimitUsd` (the cap you set) and
  `spendUsedUsd` (a running accumulator).
- **Before** any Anthropic call, the runner does an atomic DynamoDB
  `UpdateItem` with a `ConditionExpression` that reserves the
  estimated cost. If you'd exceed the cap, the condition fails and the
  run is recorded as `spend_limit_exceeded` without ever calling
  Anthropic.
- **After** a successful Anthropic call, a second `UpdateItem` corrects
  the accumulator to the actual cost.

See [spend-reservation](../data-model/spend-reservation.md) for the
exact pattern. A `runs.spend_limit_exceeded` CloudWatch alarm is
defined for this event and fires from the EMF metric (`runOutcomeMetric`)
emitted at reservation-rejection time in
[`emf.ts`](../../packages/shared/src/observability/emf.ts) and consumed by
[`MonitoringStack.buildSpendAlarm`](../../packages/infra/src/stacks/monitoring-stack.ts).

## What costs you might still see — and how to cut them

| Source             | When it shows up                                                   | How to cap further                                                                   |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Anthropic          | Always — limited by per-agent `spendLimitUsd`                      | Lower the cap on each agent                                                          |
| Lambda invocations | Per scheduled run + per API call                                   | Pause agents (`status=paused`)                                                       |
| DynamoDB           | Per request — typically pennies                                    | N/A at this scale                                                                    |
| CloudFront / S3    | Per page load                                                      | N/A at this scale                                                                    |
| Secrets Manager    | $0.40/secret/month                                                 | One secret per agent (+ optional Notion/GitHub grant secrets) — delete unused agents |
| SES                | Pay-per-use; only created when `sesSenderDomain` is set — ~$0 idle | Per-message send cost; unset `sesSenderDomain` to disable entirely                   |
| CloudWatch Logs    | Storage past retention                                             | Lower `logRetentionDays` in env config                                               |

## "I forgot about a dev environment" recovery

If you stopped using a dev environment and want it gone entirely:

```bash
pnpm --filter @agent-village/infra exec cdk destroy --all --context env=dev
```

Dev's `retainOnDelete` is `false`, so the table, bucket, and all logs
go with it. Prod retains the table by design — you'd have to delete it
manually if you really want it gone.
