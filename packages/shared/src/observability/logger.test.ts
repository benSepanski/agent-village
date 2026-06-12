import { describe, expect, it } from 'vitest';
import { createLogger, emfEnvelope } from './logger.js';
import { LOG_EVENTS } from './events.js';

describe('createLogger', () => {
  it('returns a pino logger configured with env and service base fields', () => {
    const logger = createLogger({ env: 'test', service: 'shared', level: 'silent' });
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });
});

describe('emfEnvelope', () => {
  it('hoists metric values to the root and declares them under AgentVillage', () => {
    const out = emfEnvelope({ 'runs.error': 1 }, 1750000000000);
    expect(out['runs.error']).toBe(1);
    expect(out['_aws']).toEqual({
      Timestamp: 1750000000000,
      CloudWatchMetrics: [
        {
          Namespace: 'AgentVillage',
          Dimensions: [[]],
          Metrics: [{ Name: 'runs.error', Unit: 'Count' }],
        },
      ],
    });
  });

  it('infers units from the metric-name suffix', () => {
    const out = emfEnvelope({
      'run.duration_ms': 123,
      'run.cost_usd': 0.05,
      'runs.spend_limit_exceeded': 1,
    });
    const metrics = (
      out['_aws'] as { CloudWatchMetrics: [{ Metrics: { Name: string; Unit: string }[] }] }
    ).CloudWatchMetrics[0].Metrics;
    expect(metrics).toEqual([
      { Name: 'run.duration_ms', Unit: 'Milliseconds' },
      { Name: 'run.cost_usd', Unit: 'None' },
      { Name: 'runs.spend_limit_exceeded', Unit: 'Count' },
    ]);
  });

  it('returns an empty object for an empty metric payload', () => {
    expect(emfEnvelope({})).toEqual({});
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
