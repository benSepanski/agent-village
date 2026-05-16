# Phase 1, Step 2 — Data repositories

Wrap DynamoDB access in typed repositories that consume and produce schema-validated entities.

## Files to create

```
packages/data/src/dynamo/
├── client.ts           # DocumentClient factory (LocalStack-aware via AV_LOCAL=1)
├── keys.ts             # pure helpers to compute pk/sk for each entity
├── users.ts            # userRepo: getProfile, ensureProfile
├── agents.ts           # agentRepo: list, get, create, update, delete, reserveSpend, finalizeSpend
└── runs.ts             # runRepo: append, listForAgent, getOne
```

Re-export the public methods from `packages/data/src/index.ts`.

## Patterns

- All repo methods accept and return Zod-validated entity types from `@agent-village/shared` — parse on read, validate on write.
- The client factory reads `AV_LOCAL=1` to point at DynamoDB Local instead of AWS. Same code path otherwise.
- Spend reservation lives here (`agentRepo.reserveSpend`) — see [spend-reservation](../../data-model/spend-reservation.md) for the conditional-update shape.
- Errors from AWS SDK get translated to domain errors (e.g. `ConditionalCheckFailedException` → `SpendLimitExceededError` defined in `domain/`).

## Tests

Use [`packages/data/test-utils/dynamodb-mock.ts`](../../../packages/data/test-utils/dynamodb-mock.ts) — already in place. One happy-path + one error-path test per method.

## Acceptance

- `pnpm --filter @agent-village/data test` covers all repo methods with ≥80% lines.
- `pnpm deps:check` still passes — repos only import from `shared` and `domain`.
- `pnpm typecheck` green.

## Reference

- [agent entity](../../data-model/agent.md)
- [run entity](../../data-model/run.md)
- [user entity](../../data-model/user.md)
