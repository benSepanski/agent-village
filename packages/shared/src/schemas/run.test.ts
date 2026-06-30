import { describe, expect, it } from 'vitest';
import { RunPersisted, RunSchema, RunStatus } from './run.js';

const validRun = {
  id: '01HZN0PQRSTVWXYZ0123456789',
  agentId: '01HZ1234567890ABCDEFGHJKMN',
  ownerSub: 'cog-sub-abc-123',
  status: 'ok',
  costUsd: 0.0042,
  tokensIn: 120,
  tokensOut: 85,
  output: 'Hello, world.',
  error: null,
  durationMs: 1234,
  traceId: 'Root=1-abc-def',
  model: 'claude-opus-4-7',
  systemPromptHash: 'sha256:deadbeef',
  dryRun: false,
  createdAt: '2026-05-16T12:00:00.000Z',
};

describe('RunStatus', () => {
  it('accepts ok / error / spend_limit_exceeded', () => {
    expect(RunStatus.parse('ok')).toBe('ok');
    expect(RunStatus.parse('error')).toBe('error');
    expect(RunStatus.parse('spend_limit_exceeded')).toBe('spend_limit_exceeded');
  });

  it('rejects other statuses', () => {
    expect(() => RunStatus.parse('pending')).toThrow();
  });
});

describe('RunSchema', () => {
  it('roundtrips a successful run', () => {
    const parsed = RunSchema.parse(validRun);
    expect(parsed.status).toBe('ok');
    expect(parsed.costUsd).toBeCloseTo(0.0042);
  });

  it('roundtrips a spend-rejected run with null output', () => {
    const rejected = {
      ...validRun,
      status: 'spend_limit_exceeded',
      output: null,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
    };
    const parsed = RunSchema.parse(rejected);
    expect(parsed.status).toBe('spend_limit_exceeded');
    expect(parsed.output).toBeNull();
  });

  it('rejects negative cost or tokens', () => {
    expect(() => RunSchema.parse({ ...validRun, costUsd: -0.01 })).toThrow();
    expect(() => RunSchema.parse({ ...validRun, tokensIn: -1 })).toThrow();
  });

  it('rejects non-integer token counts', () => {
    expect(() => RunSchema.parse({ ...validRun, tokensOut: 1.5 })).toThrow();
  });
});

describe('RunPersisted', () => {
  it('is interchangeable with RunSchema in Phase 1', () => {
    expect(RunPersisted.parse(validRun)).toEqual(RunSchema.parse(validRun));
  });
});

describe('RunSchema (sandbox kind)', () => {
  const sandboxRun = {
    id: '01HZN0PQRSTVWXYZ0123456789',
    agentId: '01HZ1234567890ABCDEFGHJKMN',
    ownerSub: 'cog-sub-abc-123',
    status: 'running',
    kind: 'sandbox',
    costUsd: 0.01,
    output: null,
    error: null,
    durationMs: 0,
    traceId: 'Root=1-abc-def',
    model: null,
    systemPromptHash: null,
    dryRun: false,
    taskArn: 'arn:aws:ecs:us-east-1:0:task/agent-village-dev-sandbox/abc',
    exitCode: null,
    createdAt: '2026-05-16T12:00:00.000Z',
  };

  it('accepts the new running / timed_out / launch_failed statuses', () => {
    expect(RunStatus.parse('running')).toBe('running');
    expect(RunStatus.parse('timed_out')).toBe('timed_out');
    expect(RunStatus.parse('launch_failed')).toBe('launch_failed');
  });

  it('parses a sandbox run with null model / systemPromptHash and defaults tokens to 0', () => {
    const parsed = RunSchema.parse(sandboxRun);
    expect(parsed.kind).toBe('sandbox');
    expect(parsed.model).toBeNull();
    expect(parsed.tokensIn).toBe(0);
    expect(parsed.tokensOut).toBe(0);
    expect(parsed.taskArn).toContain('task/');
  });

  it('defaults kind to inline and applies null sandbox fields for legacy runs', () => {
    const parsed = RunSchema.parse(validRun);
    expect(parsed.kind).toBe('inline');
    expect(parsed.taskArn).toBeNull();
    expect(parsed.exitCode).toBeNull();
  });

  it('rejects an inline run missing its model or systemPromptHash', () => {
    expect(() => RunSchema.parse({ ...validRun, model: null })).toThrow();
    expect(() => RunSchema.parse({ ...validRun, systemPromptHash: null })).toThrow();
  });
});
