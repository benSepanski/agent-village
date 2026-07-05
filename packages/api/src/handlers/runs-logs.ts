import { AgentId, RunId, UserId, z } from '@agent-village/shared';
import { runner } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

/** Query parameters for the CloudWatch FilterLogEvents passthrough. */
const LogsQuerySchema = z.object({
  /** CloudWatch pagination token from a previous page's `nextToken`. */
  nextToken: z.string().min(1).optional(),
  /** Epoch milliseconds; only events at or after this instant (follow polling). */
  startTime: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

/**
 * One page of a sandbox run's log events (Phase 3 step 07). Owner-scoped like
 * every other run route; the response carries the run's current status so
 * clients know whether to keep polling.
 */
export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const agentId = AgentId.parse(event.pathParameters?.['id']);
  const runId = RunId.parse(event.pathParameters?.['runId']);
  const query = LogsQuerySchema.parse(event.queryStringParameters ?? {});
  const page = await runner.getRunLogs(ownerSub, agentId, runId, {
    ...(query.nextToken !== undefined ? { nextToken: query.nextToken } : {}),
    ...(query.startTime !== undefined ? { startTimeMs: query.startTime } : {}),
    ...(query.limit !== undefined ? { limit: query.limit } : {}),
  });
  return jsonResponse(200, page);
});
