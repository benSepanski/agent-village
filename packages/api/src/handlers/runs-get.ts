import { AgentId, RunId, UserId } from '@agent-village/shared';
import { runner } from '@agent-village/services';
import { jsonResponse, withContext } from '../middleware.js';

export const handler = withContext(async (event, ctx) => {
  const ownerSub = UserId.parse(ctx.cognitoSub);
  const agentId = AgentId.parse(event.pathParameters?.['id']);
  const runId = RunId.parse(event.pathParameters?.['runId']);
  const run = await runner.getRun(ownerSub, agentId, runId);
  if (!run) return jsonResponse(404, { error: 'run not found' });
  return jsonResponse(200, run);
});
