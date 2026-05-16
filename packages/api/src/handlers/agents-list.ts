import { UserId } from '@agent-village/shared';
import { agent } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

export const handler = withContext(async (_event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const agents = await agent.listMyAgents(ownerSub);
  return jsonResponse(200, { agents });
});
