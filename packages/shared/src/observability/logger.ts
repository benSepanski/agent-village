import pino from 'pino';
import type { LogEvent } from './events.js';

export interface LogEnvelope {
  event: LogEvent;
  service?: string;
  traceId?: string;
  userId?: string;
  agentId?: string;
  runId?: string;
  metric?: Record<string, number>;
  [key: string]: unknown;
}

export interface CreateLoggerOptions {
  env: string;
  service: string;
  level?: pino.LevelWithSilent;
  pretty?: boolean;
}

const METRIC_NAMESPACE = 'AgentVillage';

/** CloudWatch metric unit inferred from the metric-name suffix convention. */
function metricUnit(name: string): 'Milliseconds' | 'None' | 'Count' {
  if (name.endsWith('_ms')) return 'Milliseconds';
  if (name.endsWith('_usd')) return 'None';
  return 'Count';
}

/**
 * CloudWatch EMF declaration for a `metric` payload. EMF requires each value
 * as a root-level key of the log line plus a `_aws` envelope; the nested
 * `metric` object stays in place for existing Logs Insights queries.
 * Dimensionless on purpose — the MonitoringStack alarms watch the bare
 * AgentVillage namespace.
 */
export function emfEnvelope(
  metric: Record<string, number>,
  timestamp: number = Date.now(),
): Record<string, unknown> {
  const names = Object.keys(metric);
  if (names.length === 0) return {};
  return {
    ...metric,
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [
        {
          Namespace: METRIC_NAMESPACE,
          Dimensions: [[]],
          Metrics: names.map((name) => ({ Name: name, Unit: metricUnit(name) })),
        },
      ],
    },
  };
}

function emfMixin(mergeObject: object): object {
  const { metric } = mergeObject as Partial<LogEnvelope>;
  return metric ? emfEnvelope(metric) : {};
}

export function createLogger(opts: CreateLoggerOptions): pino.Logger {
  const base = { env: opts.env, service: opts.service };
  const level =
    opts.level ?? (process.env['LOG_LEVEL'] as pino.LevelWithSilent | undefined) ?? 'info';

  if (opts.pretty) {
    return pino({
      level,
      base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
      },
    });
  }
  return pino({ level, base, timestamp: pino.stdTimeFunctions.isoTime, mixin: emfMixin });
}
