import { describe, expect, it } from 'vitest';
import {
  AGENT_GSI1SK_META,
  AGENT_SK_PREFIX,
  GSI1_NAME,
  RUN_SK_PREFIX,
  USER_SK_PROFILE,
  agentGsi1pk,
  agentPk,
  agentSk,
  runGsi1sk,
  runSk,
  userPk,
} from './keys.js';

describe('key helpers', () => {
  it('namespaces user partition', () => {
    expect(userPk('cog-1')).toBe('USER#cog-1');
  });

  it('namespaces agent sort key and gsi1 partition', () => {
    expect(agentSk('agent-1')).toBe('AGENT#agent-1');
    expect(agentSk('agent-1').startsWith(AGENT_SK_PREFIX)).toBe(true);
    expect(agentGsi1pk('agent-1')).toBe('AGENT#agent-1');
    expect(agentPk('agent-1')).toBe('AGENT#agent-1');
  });

  it('namespaces run sort key with timestamp and id', () => {
    const sk = runSk('2026-05-16T12:00:00.000Z', 'run-1');
    expect(sk).toBe('RUN#2026-05-16T12:00:00.000Z#run-1');
    expect(sk.startsWith(RUN_SK_PREFIX)).toBe(true);
  });

  it('namespaces run gsi1 sort key with timestamp only', () => {
    expect(runGsi1sk('2026-05-16T12:00:00.000Z')).toBe('RUN#2026-05-16T12:00:00.000Z');
  });

  it('exports the GSI name and constant sort values', () => {
    expect(GSI1_NAME).toBe('gsi1');
    expect(USER_SK_PROFILE).toBe('PROFILE');
    expect(AGENT_GSI1SK_META).toBe('META');
  });
});
