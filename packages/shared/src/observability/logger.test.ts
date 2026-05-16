import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.js';
import { LOG_EVENTS } from './events.js';

describe('createLogger', () => {
  it('returns a pino logger configured with env and service base fields', () => {
    const logger = createLogger({ env: 'test', service: 'shared', level: 'silent' });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });
});

describe('LOG_EVENTS', () => {
  it('contains the core agent-run lifecycle events', () => {
    expect(LOG_EVENTS).toContain('agent.run.started');
    expect(LOG_EVENTS).toContain('agent.run.anthropic_response');
    expect(LOG_EVENTS).toContain('agent.run.completed');
    expect(LOG_EVENTS).toContain('agent.run.failed');
  });

  it('has unique event names', () => {
    const set = new Set<string>(LOG_EVENTS);
    expect(set.size).toBe(LOG_EVENTS.length);
  });
});
