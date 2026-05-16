import { AgentId, UserId } from '@agent-village/shared';
import { runner } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const agentId = AgentId.parse(event.pathParameters?.['id']);
  const runs = await runner.listForAgent(ownerSub, agentId);
  return jsonResponse(200, { runs });
});
