import type { RunStatus } from '../schemas/run.js';

/**
 * CloudWatch Embedded Metric Format (EMF) payload for terminal run outcomes.
 *
 * The monitoring stack alarms on `AgentVillage/runs.error` and
 * `AgentVillage/runs.spend_limit_exceeded`. Merging the object returned by
 * `runOutcomeMetric` into a structured log call makes the log line a valid EMF
 * record (the `_aws` envelope is at the JSON root — extra pino keys are
 * ignored by the EMF extractor), so those alarms fire on real data.
 *
 * Callers must emit exactly once per terminal run: at the point the terminal
 * status is persisted (inline completion, spend rejection, launch failure, or
 * sandbox finalization) — never at intermediate transitions.
 */

const EMF_NAMESPACE = 'AgentVillage';

/**
 * Statuses counted as `runs.error`: app-reported failures plus platform launch
 * failures. `timed_out` is deliberately excluded — it is the kill switch doing
 * its job, visible on the run record, not an alarm-worthy platform error.
 */
const ERROR_STATUSES: ReadonlySet<RunStatus> = new Set(['error', 'launch_failed']);

function metricName(status: RunStatus): string | null {
  if (ERROR_STATUSES.has(status)) return 'runs.error';
  if (status === 'spend_limit_exceeded') return 'runs.spend_limit_exceeded';
  return null;
}

/**
 * EMF fields counting one terminal run outcome, to be spread into a structured
 * log call: `logger.info({ event: '...', ...runOutcomeMetric(status) })`.
 * Returns `{}` for statuses that have no alarm metric (e.g. `ok`).
 */
export function runOutcomeMetric(status: RunStatus): Record<string, unknown> {
  const name = metricName(status);
  if (!name) return {};
  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: EMF_NAMESPACE,
          // No dimensions: the alarms aggregate across all agents.
          Dimensions: [[]],
          Metrics: [{ Name: name, Unit: 'Count' }],
        },
      ],
    },
    [name]: 1,
  };
}
