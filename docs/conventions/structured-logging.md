# Structured logging

Every log call passes an object literal whose `event` key is one of the closed-enum names in [`packages/shared/src/observability/events.ts`](../../packages/shared/src/observability/events.ts).

## Do

```ts
import { createLogger } from '@agent-village/shared/observability';

const logger = createLogger({ env: 'dev', service: 'runner' });

logger.info({ event: 'agent.run.started', agentId, runId, traceId });
logger.error({ event: 'agent.run.failed', agentId, runId, traceId, err });
```

## Don't (will fail `pnpm lint`)

```ts
logger.info('agent started'); // free-form string
logger.info(`agent ${agentId} started`); // template literal
logger.info({ msg: 'started', agentId }); // missing `event`
```

The custom ESLint rule `@agent-village/logger-must-use-event-envelope` fires with the exact fix as the error message.

## Adding a new event

1. Add the name to the `LOG_EVENTS` const tuple in [`events.ts`](../../packages/shared/src/observability/events.ts). Keep names dotted: `<noun>.<action>` (e.g. `agent.run.started`).
2. Use it in your log call.

That's it — no separate registration step.

## Emitting metrics

The same `logger.info(...)` call carries numeric measurements via the `metric` key:

```ts
logger.info({
  event: 'agent.run.completed',
  agentId,
  runId,
  metric: { 'run.cost_usd': costUsd, 'run.duration_ms': durationMs },
});
```

The values are queryable in CloudWatch Logs Insights. The logger does not yet wrap them in the CloudWatch EMF envelope, so they do not become CloudWatch metrics — see the known gap in [observability](../architecture/observability.md#metrics).
