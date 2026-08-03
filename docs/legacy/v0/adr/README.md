# Architecture Decision Records

Append-only log of architectural decisions. Never edit an existing ADR — write a new one that supersedes it.

| ADR                                      | Title                                                            | Status   |
| ---------------------------------------- | ---------------------------------------------------------------- | -------- |
| [0001](0001-typescript-cdk-dynamodb.md)  | TypeScript everywhere, AWS CDK, DynamoDB single-table            | Accepted |
| [0002](0002-fargate-sandbox-runs.md)     | Sandboxed application runs on Fargate + S3 workspaces            | Accepted |
| [0003](0003-egress-proxy-sidecar.md)     | Egress proxy as a per-run Fargate sidecar                        | Accepted |
| [0004](0004-metered-anthropic-access.md) | Metered Anthropic access for sandbox runs via a platform gateway | Accepted |

## Adding a new ADR

1. Copy [TEMPLATE.md](TEMPLATE.md) → `NNNN-<short-slug>.md` (next number).
2. Fill in Context, Decision, Consequences.
3. Add a row to the table above.
4. If this ADR supersedes an existing one, the existing one's Status becomes `Superseded by ADR-NNNN`. (Edit the _status line only_ — that's the one exception to the append-only rule.)
