# Phase 1, Step 1 — Schemas

Define every entity and HTTP I/O shape as a Zod schema in `@agent-village/shared`. Other layers depend on these.

## Files to create

```
packages/shared/src/schemas/
├── user.ts             # UserSchema, UserId
├── agent.ts            # AgentSchema, AgentId, CreateAgentInput, UpdateAgentInput
├── run.ts              # RunSchema, RunId, RunStatus, RunPersisted
├── ids.ts              # zUlid() helper; identifier types
└── index.ts            # re-exports
```

Update `packages/shared/src/index.ts` to re-export `./schemas/index.js`.

## What each schema covers

- **`UserSchema`**: `cognitoSub`, `email`, `displayName`, `createdAt`.
- **`AgentSchema`**: `id`, `ownerSub`, `name` (≤80 chars), `model`, `systemPrompt`, `schedule` (string | null), `spendLimitUsd` (positive number), `spendUsedUsd`, `anthropicSecretArn`, `status` (`active` | `paused`), timestamps.
- **`CreateAgentInput`**: subset users can POST; excludes server-set fields like `spendUsedUsd`, `anthropicSecretArn`. Includes a plaintext `anthropicApiKey` that the services layer stores in Secrets Manager and discards.
- **`UpdateAgentInput`**: partial of CreateAgentInput; `anthropicApiKey` optional.
- **`RunSchema`**: `id`, `agentId`, `ownerSub`, `status`, `costUsd`, `tokensIn`, `tokensOut`, `output` (string | null), `error` (string | null), `durationMs`, `traceId`, `model`, `systemPromptHash`, `dryRun`, `createdAt`.

## Acceptance

- `pnpm --filter @agent-village/shared test` passes a small schema-roundtrip test per entity.
- `pnpm typecheck` green across the workspace.
- Importing `import { AgentSchema } from '@agent-village/shared'` works from `data/`, `services/`, `web/`.

## Reference

- [data-model overview](../../data-model/README.md)
- [schemas-at-boundaries](../../conventions/schemas-at-boundaries.md)
