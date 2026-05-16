# Cost guards

Two layers: AWS account-level, and per-agent application-level.

## Account-level (cdk)

- **AWS Budgets** per env (`$5/mo` dev, `$20/mo` prod) with email alarms at 50/80/100%. See [`MonitoringStack`](../../packages/infra/src/stacks/monitoring-stack.ts).
- **CloudWatch Logs retention** — 7d dev, 30d prod. Default is "forever" which silently adds up.
- **DynamoDB pay-per-request** — no idle provisioned capacity.
- **No NAT Gateway, no VPC** — all serverless services are public + IAM.
- **Lambda memory** tuned per env (256 MB dev, up to 512 MB prod runner).

## Per-agent (application)

- Each Agent record has `spendLimitUsd` (config) and `spendUsedUsd` (accumulator).
- Before any Anthropic call, the runner does an atomic DynamoDB `UpdateItem` with a `ConditionExpression` that reserves the estimated cost. If the condition fails, the run is recorded as `spend_limit_exceeded` without calling Anthropic.
- After a successful Anthropic call, a second `UpdateItem` corrects the accumulator to the actual cost.

See [spend-reservation](../data-model/spend-reservation.md) for the exact pattern.

## What costs you might still see

| Source             | When it shows up                              | How to cap further                         |
| ------------------ | --------------------------------------------- | ------------------------------------------ |
| Anthropic          | Always — limited by per-agent `spendLimitUsd` | Lower the cap                              |
| Lambda invocations | Per-run                                       | Pause agents (`status=paused`)             |
| DynamoDB           | Per request — typically pennies               | N/A at this scale                          |
| CloudFront / S3    | Per page load                                 | N/A at this scale                          |
| Secrets Manager    | $0.40/secret/month                            | One secret per agent; delete unused agents |
