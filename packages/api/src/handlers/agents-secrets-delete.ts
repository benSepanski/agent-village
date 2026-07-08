import { AgentId, SecretLeafName, UserId } from '@agent-village/shared';
import { agentSecrets } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const agentId = AgentId.parse(event.pathParameters?.['id']);
  const name = SecretLeafName.parse(event.pathParameters?.['name']);
  await agentSecrets.deleteAgentSecret(ownerSub, agentId, name);
  return jsonResponse(204, '');
});
