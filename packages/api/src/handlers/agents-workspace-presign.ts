import { AgentId, PresignWorkspaceInput, UserId } from '@agent-village/shared';
import { workspace } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const agentId = AgentId.parse(event.pathParameters?.['id']);
  const input = PresignWorkspaceInput.parse(JSON.parse(event.body ?? '{}'));
  const presigned = await workspace.presignWorkspace(ownerSub, agentId, input);
  return jsonResponse(200, presigned);
});
