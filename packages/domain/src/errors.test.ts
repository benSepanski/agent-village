import { describe, expect, it } from 'vitest';
import {
  AgentNotFoundError,
  AgentRunInProgressError,
  InvalidScheduleError,
  SecretPendingDeletionError,
  SpendLimitExceededError,
} from './errors.js';

describe('SpendLimitExceededError', () => {
  it('carries details and a 402 status', () => {
    const err = new SpendLimitExceededError({
      agentId: 'agent-1',
      spendLimitUsd: 1,
      spendUsedUsd: 0.99,
      estimateUsd: 0.05,
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(402);
    expect(err.name).toBe('SpendLimitExceededError');
    expect(err.message).toContain('agent-1');
    expect(err.details.spendLimitUsd).toBe(1);
  });
});

describe('AgentNotFoundError', () => {
  it('carries an agentId and a 404 status', () => {
    const err = new AgentNotFoundError('agent-2');
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe('AgentNotFoundError');
    expect(err.message).toContain('agent-2');
    expect(err.details.agentId).toBe('agent-2');
  });
});

describe('AgentRunInProgressError', () => {
  it('carries an agentId and a 409 status', () => {
    const err = new AgentRunInProgressError('agent-3');
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe('AgentRunInProgressError');
    expect(err.message).toContain('agent-3');
    expect(err.details.agentId).toBe('agent-3');
  });
});

describe('SecretPendingDeletionError', () => {
  it('carries the agentId and secret name with a 409 status', () => {
    const err = new SecretPendingDeletionError('agent-4', 'gmail-app-password');
    expect(err.statusCode).toBe(409);
    expect(err.name).toBe('SecretPendingDeletionError');
    expect(err.message).toContain('gmail-app-password');
    expect(err.details).toEqual({ agentId: 'agent-4', secretName: 'gmail-app-password' });
  });
});

describe('InvalidScheduleError', () => {
  it('returns a 400 with the offending schedule', () => {
    const err = new InvalidScheduleError('not a cron');
    expect(err.statusCode).toBe(400);
    expect(err.message).toContain('not a cron');
    expect(err.details.schedule).toBe('not a cron');
    expect(err.details.reason).toBeUndefined();
  });

  it('optionally captures a reason', () => {
    const err = new InvalidScheduleError('* * * *', 'expected 5 fields, got 4');
    expect(err.message).toContain('expected 5 fields');
    expect(err.details.reason).toBe('expected 5 fields, got 4');
  });
});
