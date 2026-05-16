# Conventions

These are load-bearing — break them and CI fails. Read the section that
applies to your change before opening a PR.

## Structured logging

Every log call MUST pass an object literal whose `event` field is one of the
closed-enum names exported from [`packages/shared/src/observability/events.ts`](../packages/shared/src/observability/events.ts).

```ts
import { createLogger } from '@agent-village/shared/observability';

const logger = createLogger({ env: 'dev', service: 'runner' });

logger.info({ event: 'agent.run.started', agentId, runId, traceId });
logger.error({ event: 'agent.run.failed', agentId, runId, traceId, err });
```

**Forbidden** (will fail `pnpm lint`):

```ts
logger.info('agent started'); // free-form string
logger.info(`agent ${agentId} started`); // template literal
logger.info({ msg: 'started', agentId }); // missing `event`
```

The error message tells you the exact fix. If you need a new event name, add
it to the enum and document its meaning.

## Schemas at the trust boundary

Anything crossing a process or trust boundary (HTTP request body, EventBridge
payload, DynamoDB item, Secrets Manager value) MUST be parsed through a Zod
schema from `@agent-village/shared/schemas`. The custom ESLint rule
`handler-must-validate-with-zod` enforces this for Lambda handler files.

```ts
import { CreateAgentInput } from '@agent-village/shared/schemas';

export const handler = async (event: APIGatewayProxyEventV2) => {
  const input = CreateAgentInput.parse(JSON.parse(event.body ?? '{}'));
  // ...
};
```

## Error handling

- Throw `Error` (or a domain-specific subclass) — never throw strings.
- Catch and translate at the layer boundary; lower layers don't know what HTTP is.
- Log every error you catch with a structured event whose name ends in `.error` or `.failed`.
- Never swallow an error silently. If suppressing is correct, log it as `.suppressed`.

## File sizes and complexity

Lint hard bounds (errors, never warnings):

| Metric                | Bound     |
| --------------------- | --------- |
| Cyclomatic complexity | 10        |
| Max nesting depth     | 4         |
| Function length       | 50 lines  |
| File length           | 300 lines |
| Function params       | 4         |
| Function statements   | 15        |

When you hit one, the message names the rule. The fix is almost always
"extract a helper" — don't suppress.

## Naming

- File names: `kebab-case.ts`. One default export → file name matches export.
- Class names: `PascalCase`. Function names: `camelCase`. Constants: `SCREAMING_SNAKE_CASE`.
- Tests live next to the code as `<name>.test.ts`. Structural tests live in `tests/structural/`.

## Module boundaries

Always import from a package's public entry (e.g. `@agent-village/shared`), never
from `packages/<x>/src/...`. The dependency-cruiser rule
`no-deep-import-of-internal` enforces this.

If you need to expose a new helper from a package, add it to that package's
`exports` map and re-export from its `src/index.ts`.

## Comments

Default to none. Add one only when the **why** is non-obvious — a subtle
invariant, a workaround for an external bug, a constraint that future-you
would forget. Never describe **what** the code does; well-named identifiers
already do that.
