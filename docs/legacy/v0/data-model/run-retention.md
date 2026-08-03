# Run retention

## In DynamoDB

- Run records are never deleted automatically — there is no TTL attribute and no cleanup job. They accumulate indefinitely.
- `output` and `error` are stored inline on the run item as nullable strings ([`RunSchema`](../../packages/shared/src/schemas/run.ts)). There is no overflow path to S3; output size is naturally bounded by the runner's `max_tokens` ceiling (1024, or 256 for dry runs — see [`runner.ts`](../../packages/services/src/runner.ts)).

## In CloudWatch Logs

- 7-day retention in dev, 30-day in prod, set via `logRetentionDays` in [`packages/infra/config/`](../../packages/infra/config/).

## Sandbox workspaces (S3)

- The workspace bucket is versioned; noncurrent object versions expire after 30 days (dev) / 90 days (prod) via lifecycle rule ([`sandbox-stack.ts`](../../packages/infra/src/stacks/sandbox-stack.ts)). Current versions are kept until explicitly deleted.

## Deleting an agent

When an Agent record is deleted, its Runs are **not** deleted. They remain queryable by the owning user via the GSI (`gsi1pk=USER#<sub>`). Retention policies and an audit summarizer are on the roadmap ([phases](../phases/phase-2-plus.md)).
