import { createLogger } from '@agent-village/shared';
import { runner } from '@agent-village/services';

const logger: ReturnType<typeof createLogger> = createLogger({
  env: process.env['AV_ENV'] ?? 'dev',
  service: 'runner-sweeper',
});

/**
 * Scheduled (EventBridge rate rule) backstop: finalize sandbox runs wedged in
 * `status:'running'` past their maximum lifetime — a poison-pill stop event or
 * a lifecycle-finalizer outage would otherwise pin an agent's one-run slot
 * forever. Reuses the lifecycle settlement path, so it is fail-safe and
 * idempotent (see services/sandbox-sweeper.ts).
 */
export async function handler(): Promise<void> {
  try {
    const { found, finalized } = await runner.sweepStuckSandboxRuns();
    if (found > 0) {
      logger.warn({ event: 'sandbox.sweeper.swept', metric: { found, finalized } });
    }
  } catch (err) {
    logger.error({ event: 'sandbox.sweeper.failed', err });
    throw err;
  }
}
