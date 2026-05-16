import { AgentId, createLogger, z } from '@agent-village/shared';
import { runner } from '@agent-village/services';

const logger: ReturnType<typeof createLogger> = createLogger({
  env: process.env['AV_ENV'] ?? 'dev',
  service: 'runner',
});

const EventSchema = z.object({ agentId: AgentId });

interface RunnerResult {
  runId: string;
  status: string;
}

export async function handler(event: unknown): Promise<RunnerResult> {
  try {
    const { agentId } = EventSchema.parse(event);
    const result = await runner.executeRun({ agentId });
    return { runId: result.runId, status: result.status };
  } catch (err) {
    logger.error({ event: 'agent.run.failed', err });
    throw err;
  }
}
