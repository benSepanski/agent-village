import { AgentId, UpdateAgentInput, UserId } from '@agent-village/shared';
import { agent } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const agentId = AgentId.parse(event.pathParameters?.['id']);
  const patch = UpdateAgentInput.parse(JSON.parse(event.body ?? '{}'));
  const updated = await agent.updateAgent(ownerSub, agentId, patch);
  return jsonResponse(200, updated);
});
