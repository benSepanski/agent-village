# Playbook: add a Lambda

Use this to add a new HTTP endpoint (`packages/api/`) or a scheduled / event-driven worker (`packages/runner/`).

## HTTP endpoint

### 1. Write the handler

One file per route at `packages/api/src/handlers/<name>.ts`. The file name must match the `name` you register in step 2. Handlers are thin: wrap with `withContext()`, parse input through a shared Zod schema, call one service function, return `jsonResponse()`. Copy the shape of an existing handler, e.g. [`agents-create.ts`](../../packages/api/src/handlers/agents-create.ts):

```ts
import { CreateAgentInput, UserId } from '@agent-village/shared';
import { agent } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const input = CreateAgentInput.parse(JSON.parse(event.body ?? '{}'));
  const created = await agent.createAgent(ownerSub, input);
  return jsonResponse(201, created);
});
```

[`withContext()`](../../packages/api/src/middleware.ts) supplies everything cross-cutting — JWT claim extraction into `ctx` (`cognitoSub`, `email`, `traceId`), `http.request.*` structured logging, and error translation (ZodError → 400, domain errors → their `statusCode`, anything else → 500). Don't log or catch in the handler itself.

Lint enforces a `.parse(...)` call through a `@agent-village/shared` schema in every handler file ([schemas-at-boundaries](../conventions/schemas-at-boundaries.md)). New input/output shapes go in [`packages/shared/src/schemas/`](../../packages/shared/src/schemas/) and are re-exported from its `index.ts`.

### 2. Register it in the `HANDLERS` array

Routes, permissions, and Lambda creation are all driven by the [`HANDLERS` registry in `api-stack.ts`](../../packages/infra/src/stacks/api-stack.ts) — there is no per-handler CDK code to write. Add one entry:

```ts
{ name: 'agents-archive', method: HttpMethod.POST, routePath: '/agents/{id}/archive', perms: 'write' },
```

- `name` must equal the handler file name (the stack bundles `handlers/${name}.ts`).
- `perms: 'read'` grants DynamoDB read; `'write'` grants read/write **plus** CRUD on the env's agent secrets.
- `needsScheduler: true` adds EventBridge Scheduler permissions (needed by anything that changes an agent's schedule).

Every registered route automatically gets the Cognito JWT authorizer, a log group with env-appropriate retention, and memory from `apiMemoryMb` in [`config/`](../../packages/infra/config/).

### 3. Test it

API handler tests mock the **services layer** (not the AWS SDK) and invoke the handler with a synthetic API Gateway event that includes JWT claims — copy the pattern in [`handlers.test.ts`](../../packages/api/src/handlers/handlers.test.ts). `aws-sdk-client-mock` is for `packages/data` tests.

## Scheduled / event-driven worker

The runner package has a single Lambda ([`runner/src/handler.ts`](../../packages/runner/src/handler.ts)) that parses its event with a Zod schema and delegates to `@agent-village/services`. A new event-driven workload usually means a new branch of the runner's input schema or a new function in [`runner-stack.ts`](../../packages/infra/src/stacks/runner-stack.ts) following the same `NodejsFunction` shape (log group, ARM64, env vars, scoped IAM grants). Adding a whole new Lambda to the stack is an [Ask-first](../permissions/ask-first.md) change if it adds new AWS surface.

## Verify, then ship

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @agent-village/infra synth:dev   # confirms CDK still synthesizes
```

Merge to `main` → auto-deploy to dev. Tag `v*` → prod after manual approval. Details: [deploy-env](deploy-env.md).
