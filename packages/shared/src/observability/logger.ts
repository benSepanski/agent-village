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
  return pino({ level, base, timestamp: pino.stdTimeFunctions.isoTime });
}
