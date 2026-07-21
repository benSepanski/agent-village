import { createLogger } from '@agent-village/shared';
import { budgetDrift } from '@agent-village/services';

const logger: ReturnType<typeof createLogger> = createLogger({
  env: process.env['AV_ENV'] ?? 'dev',
  service: 'runner-budget-drift',
});

/**
 * Scheduled (EventBridge rate rule) report-only pass: recomputes every
 * agent's lifetime spend and every budgeted user's current-month window from
 * run records, and emits the `budget.drift_usd` EMF gauge the monitoring
 * stack alarms on. Never writes a correction — see services/budget-drift.ts,
 * which logs its own per-scope and pass-summary events.
 */
export async function handler(): Promise<void> {
  try {
    await budgetDrift.checkBudgetDrift();
  } catch (err) {
    logger.error({ event: 'budget.drift.failed', err });
    throw err;
  }
}
