import { CreateAgentInput, UserId } from '@agent-village/shared';
import { agent } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const input = CreateAgentInput.parse(JSON.parse(event.body ?? '{}'));
  const created = await agent.createAgent(ownerSub, input);
  return jsonResponse(201, created);
});
