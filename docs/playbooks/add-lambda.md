# Playbook: add a Lambda

Use this when you need a new HTTP endpoint or scheduled task.

## 1. Decide which package

- HTTP endpoint → `packages/api/`
- Scheduled / event-driven worker → `packages/runner/`

## 2. Add the handler file

Path convention: `packages/<api|runner>/src/handlers/<name>.ts`.

```ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { SomeInputSchema } from '@agent-village/shared/schemas';
import { someUseCase } from '@agent-village/services';

const logger = new Logger({ serviceName: 'api' });
const tracer = new Tracer({ serviceName: 'api' });

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const input = SomeInputSchema.parse(JSON.parse(event.body ?? '{}'));
  logger.info({ event: 'http.request.received', path: event.rawPath });
  const result = await someUseCase(input);
  return { statusCode: 200, body: JSON.stringify(result) };
};

export const main = tracer.captureLambdaHandler(handler);
```

Required by lint:

- An import from `@agent-village/shared` (the schema).
- A `.parse(...)` call before using input.
- A structured-log call with `event: 'http.request.received'` (or similar).

## 3. Wire it into CDK

Add a `NodejsFunction` to `packages/infra/src/stacks/api-stack.ts` (or
`runner-stack.ts`). Bundle the handler with `esbuild` via CDK's built-in
support. Set memory + timeout from the env config.

## 4. Add a unit test

Mock AWS SDK calls with `aws-sdk-client-mock` (helpers in
`packages/data/test-utils/`). Test the happy path + each error branch.

## 5. Run locally before deploying

```bash
pnpm typecheck && pnpm lint && pnpm test
pnpm dev                # invokes the handler via AWS RIE locally
```

## 6. Deploy

Push to a PR → CI runs. Merge to `main` → `dev` deploys automatically.
Tag `v*` → `prod` deploys after manual approval.
