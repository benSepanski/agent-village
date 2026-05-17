import { AgentId, UserId } from '@agent-village/shared';
import { agent } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const agentId = AgentId.parse(event.pathParameters?.['id']);
  await agent.deleteAgent(ownerSub, agentId);
  return jsonResponse(204, '');
});
