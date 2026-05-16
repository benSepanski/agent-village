# Schemas at the trust boundary

Anything crossing a process or trust boundary MUST be parsed through a Zod schema from `@agent-village/shared/schemas`.

## What counts as a "boundary"

- HTTP request body / query params / path params.
- EventBridge / SQS / SNS event payloads.
- DynamoDB items being read out of the table.
- Secrets Manager values.
- Anthropic API responses.

## How

```ts
import { CreateAgentInput } from '@agent-village/shared/schemas';

export const handler = async (event: APIGatewayProxyEventV2) => {
  const input = CreateAgentInput.parse(JSON.parse(event.body ?? '{}'));
  //                                                  ^ Zod throws on invalid input
  // ...
};
```

The custom ESLint rule `@agent-village/handler-must-validate-with-zod` enforces this for any file under `packages/api/**/handlers/*.ts` or `packages/runner/**/handler.ts`.

## Where schemas live

All entity / input / output shapes are defined in [`packages/shared/src/schemas/`](../../packages/shared/src/schemas/) and re-exported as both runtime Zod schemas and TS types. Frontend and backend import the same module — the wire format and the types cannot drift.

## Inside the trust boundary

Inside `domain/`, `services/`, etc., you may pass already-parsed types around without re-validating. The parse cost happens once at the edge.
