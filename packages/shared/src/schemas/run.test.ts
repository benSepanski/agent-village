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
