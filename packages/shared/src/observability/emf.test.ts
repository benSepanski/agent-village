import { describe, expect, it } from 'vitest';
import { budgetDriftMetric, runOutcomeMetric } from './emf.js';

interface EmfShape {
  _aws: {
    Timestamp: number;
    CloudWatchMetrics: Array<{
      Namespace: string;
      Dimensions: string[][];
      Metrics: Array<{ Name: string; Unit: string }>;
    }>;
  };
  [key: string]: unknown;
}

describe('runOutcomeMetric', () => {
  it('counts status=error as runs.error', () => {
    const payload = runOutcomeMetric('error') as EmfShape;
    expect(payload['runs.error']).toBe(1);
    const spec = payload._aws.CloudWatchMetrics[0]!;
    expect(spec.Namespace).toBe('AgentVillage');
    expect(spec.Dimensions).toEqual([[]]);
    expect(spec.Metrics).toEqual([{ Name: 'runs.error', Unit: 'Count' }]);
    expect(payload._aws.Timestamp).toBeTypeOf('number');
  });

  it('counts status=launch_failed as runs.error too', () => {
    const payload = runOutcomeMetric('launch_failed') as EmfShape;
    expect(payload['runs.error']).toBe(1);
  });

  it('counts status=spend_limit_exceeded as runs.spend_limit_exceeded', () => {
    const payload = runOutcomeMetric('spend_limit_exceeded') as EmfShape;
    expect(payload['runs.spend_limit_exceeded']).toBe(1);
    expect(payload._aws.CloudWatchMetrics[0]!.Metrics[0]!.Name).toBe('runs.spend_limit_exceeded');
  });

  it('is empty for statuses without an alarm metric', () => {
    expect(runOutcomeMetric('ok')).toEqual({});
    expect(runOutcomeMetric('running')).toEqual({});
    expect(runOutcomeMetric('timed_out')).toEqual({});
  });
});

describe('budgetDriftMetric', () => {
  it('reports the absolute drift as a gauge', () => {
    const payload = budgetDriftMetric(-0.42) as EmfShape;
    expect(payload['budget.drift_usd']).toBeCloseTo(0.42);
    const spec = payload._aws.CloudWatchMetrics[0]!;
    expect(spec.Namespace).toBe('AgentVillage');
    expect(spec.Dimensions).toEqual([[]]);
    expect(spec.Metrics).toEqual([{ Name: 'budget.drift_usd', Unit: 'None' }]);
    expect(payload._aws.Timestamp).toBeTypeOf('number');
  });

  it('reports zero drift as zero', () => {
    const payload = budgetDriftMetric(0) as EmfShape;
    expect(payload['budget.drift_usd']).toBe(0);
  });
});
