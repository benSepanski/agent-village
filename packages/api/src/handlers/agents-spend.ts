import { AgentId, UserId } from '@agent-village/shared';
import { runner } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

/** Month-to-date spend for one agent, summed live from its run records. */
export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const agentId = AgentId.parse(event.pathParameters?.['id']);
  const spend = await runner.monthToDateSpend(ownerSub, agentId);
  return jsonResponse(200, spend);
});
