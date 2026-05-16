# Architecture Decision Records

Append-only log of architectural decisions. Never edit an existing ADR — write a new one that supersedes it.

| ADR                                     | Title                                                 | Status   |
| --------------------------------------- | ----------------------------------------------------- | -------- |
| [0001](0001-typescript-cdk-dynamodb.md) | TypeScript everywhere, AWS CDK, DynamoDB single-table | Accepted |

## Adding a new ADR

1. Copy [TEMPLATE.md](TEMPLATE.md) → `NNNN-<short-slug>.md` (next number).
2. Fill in Context, Decision, Consequences.
3. Add a row to the table above.
4. If this ADR supersedes an existing one, the existing one's Status becomes `Superseded by ADR-NNNN`. (Edit the _status line only_ — that's the one exception to the append-only rule.)
