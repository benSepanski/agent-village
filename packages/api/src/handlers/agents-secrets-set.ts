import { AgentId, SecretLeafName, UserId, z } from '@agent-village/shared';
import { agentSecrets } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

// `value` stays a plain z.string() (no format checks) so a Zod issue can never
// embed the submitted secret text in the 400 response body.
const SetSecretBody = z.object({
  name: SecretLeafName,
  value: z.string().min(1),
});

export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const agentId = AgentId.parse(event.pathParameters?.['id']);
  const { name, value } = SetSecretBody.parse(JSON.parse(event.body ?? '{}'));
  const stored = await agentSecrets.setAgentSecret(ownerSub, agentId, name, value);
  return jsonResponse(200, stored);
});
