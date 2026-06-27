import { AgentId, RunId, createLogger, z } from '@agent-village/shared';
import { runner } from '@agent-village/services';

const logger: ReturnType<typeof createLogger> = createLogger({
  env: process.env['AV_ENV'] ?? 'dev',
  service: 'runner-lifecycle',
});

/** Mirrors the launcher's `group = av:<agentId>` convention (see services/sandbox.ts). */
const AGENT_GROUP_PREFIX = 'av:';

const EcsTaskStateChangeSchema = z.object({
  detail: z.object({
    lastStatus: z.string(),
    startedBy: z.string().optional(),
    group: z.string().optional(),
    stoppedReason: z.string().optional(),
    startedAt: z.string().optional(),
    stoppedAt: z.string().optional(),
    containers: z
      .array(z.object({ name: z.string().optional(), exitCode: z.number().int().optional() }))
      .optional(),
  }),
});

type TaskDetail = z.infer<typeof EcsTaskStateChangeSchema>['detail'];

function toDurationMs(detail: TaskDetail): number {
  if (!detail.startedAt || !detail.stoppedAt) return 0;
  const ms = new Date(detail.stoppedAt).getTime() - new Date(detail.startedAt).getTime();
  return ms > 0 ? Math.round(ms) : 0;
}

function appExitCode(detail: TaskDetail): number | null {
  return detail.containers?.find((c) => c.name === 'app')?.exitCode ?? null;
}

/**
 * EventBridge target for "ECS Task State Change" (STOPPED) events. Recovers the
 * run id from `startedBy` and the agent id from `group`, then finalizes the run.
 */
export async function handler(event: unknown): Promise<void> {
  try {
    const { detail } = EcsTaskStateChangeSchema.parse(event);
    if (detail.lastStatus !== 'STOPPED') return;
    const runId = RunId.parse(detail.startedBy);
    const agentId = AgentId.parse((detail.group ?? '').slice(AGENT_GROUP_PREFIX.length));
    await runner.finalizeSandboxRun({
      agentId,
      runId,
      exitCode: appExitCode(detail),
      ...(detail.stoppedReason ? { stoppedReason: detail.stoppedReason } : {}),
      durationMs: toDurationMs(detail),
    });
  } catch (err) {
    logger.error({ event: 'agent.run.failed', err });
    throw err;
  }
}
