# Run retention

## In DynamoDB

- Runs are not deleted automatically in Phase 1.
- Output and error fields are stored inline up to a per-env size cap (~10 KB dev, ~4 KB prod). Larger bodies are truncated with a marker and the full body is written to S3 (`s3://agent-village-{env}-runs/<runId>.json`); the run record stores the S3 key.

## In S3

- Bucket lifecycle policy (Phase 1 infra task): transition to Glacier after 90 days, expire after 365 days. Configurable per env.

## In CloudWatch Logs

- 7 day retention dev, 30 day retention prod. Set in [`packages/infra/config/`](../../packages/infra/config/).

## Deleting an agent

When an Agent record is deleted, its Runs are **not** deleted. They remain queryable by the parent User via the GSI. A future Phase 8 "audit summarizer" agent may roll old runs into summaries.
