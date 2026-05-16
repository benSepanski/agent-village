# Phase 1, Step 7 — API handlers

HTTP handlers in `packages/api/`. Each one is a thin Lambda wrapper around a `services/` call.

## Files to create

```
packages/api/src/handlers/
├── me.ts                       # GET /me           → services.user.ensureProfile
├── agents-list.ts              # GET /agents       → services.agent.listMyAgents
├── agents-create.ts            # POST /agents      → services.agent.createAgent
├── agents-get.ts               # GET /agents/{id}  → services.agent.getMyAgent
├── agents-update.ts            # PATCH /agents/{id}→ services.agent.updateAgent
├── agents-delete.ts            # DELETE /agents/{id}→ services.agent.deleteAgent
├── agents-run-now.ts           # POST /agents/{id}/run-now → services.runner.executeRun
├── runs-list.ts                # GET /agents/{id}/runs    → services.runner.listForAgent
└── runs-get.ts                 # GET /agents/{id}/runs/{runId} → services.runner.getOne
```

Plus `packages/api/src/middleware.ts` for JWT-claim extraction and structured-log middleware shared by every handler.

## Pattern

Each handler file looks like ([add-lambda playbook](../../playbooks/add-lambda.md)):

```ts
import { withContext } from '../middleware.js';
import { CreateAgentInput } from '@agent-village/shared/schemas';
import { agent } from '@agent-village/services';

export const handler = withContext(async (event, ctx) => {
  const input = CreateAgentInput.parse(JSON.parse(event.body ?? '{}'));
  const result = await agent.createAgent(ctx.cognitoSub, input);
  return { statusCode: 201, body: JSON.stringify(result) };
});
```

The custom lint rule requires the schema import and the `.parse(...)` call.

## Acceptance

- Each handler has a unit test that mocks the underlying `services` function.
- `pnpm --filter @agent-village/api test` green, ≥80% lines.
- `pnpm lint` green (custom rule satisfied).

## Reference

- [add-lambda playbook](../../playbooks/add-lambda.md)
- [schemas-at-boundaries](../../conventions/schemas-at-boundaries.md)
