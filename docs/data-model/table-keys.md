# Table keys

Table name: `agent-village-{env}`. Mode: pay-per-request.

| Key      | Type           | Notes             |
| -------- | -------------- | ----------------- |
| `pk`     | string (HASH)  | Primary partition |
| `sk`     | string (RANGE) | Primary sort      |
| `gsi1pk` | string (HASH)  | GSI partition     |
| `gsi1sk` | string (RANGE) | GSI sort          |

One GSI named `gsi1`, projects `ALL`.

## Why single-table

- Most access patterns are scoped to a user or to an agent — fits naturally into a partition.
- Single-table avoids paying for multiple base tables when one would do.
- The four-key shape is intentionally generic so new entities can be added without schema changes.

## Item identifier prefixes

All `pk` / `sk` / `gsi1pk` / `gsi1sk` values follow `<ENTITY>#<id>` (e.g. `USER#abc123`). The prefix gates `begins_with(...)` queries and makes ad-hoc DDB browsing legible.

## Defined entities

- [User](user.md)
- [Agent](agent.md)
- [Run](run.md)
