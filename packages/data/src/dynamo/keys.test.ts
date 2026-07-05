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
  runMonthSkPrefix,
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

  it('builds a UTC month prefix that run sort keys begin with', () => {
    const prefix = runMonthSkPrefix(new Date('2026-05-16T12:00:00.000Z'));
    expect(prefix).toBe('RUN#2026-05-');
    expect(runSk('2026-05-16T12:00:00.000Z', 'run-1').startsWith(prefix)).toBe(true);
  });

  it('covers the month boundaries and excludes neighboring months', () => {
    const prefix = runMonthSkPrefix(new Date('2026-07-31T23:59:59.999Z'));
    expect(runSk('2026-07-01T00:00:00.000Z', 'a').startsWith(prefix)).toBe(true);
    expect(runSk('2026-07-31T23:59:59.999Z', 'b').startsWith(prefix)).toBe(true);
    expect(runSk('2026-06-30T23:59:59.999Z', 'c').startsWith(prefix)).toBe(false);
    expect(runSk('2026-08-01T00:00:00.000Z', 'd').startsWith(prefix)).toBe(false);
  });

  it('zero-pads single-digit months so January cannot match October–December', () => {
    const prefix = runMonthSkPrefix(new Date('2026-01-15T00:00:00.000Z'));
    expect(prefix).toBe('RUN#2026-01-');
    expect(runSk('2026-10-01T00:00:00.000Z', 'x').startsWith(prefix)).toBe(false);
  });

  it('uses the UTC month, not the local one, at year rollover', () => {
    // One millisecond before the UTC new year is still December in UTC
    // regardless of the host timezone.
    expect(runMonthSkPrefix(new Date('2025-12-31T23:59:59.999Z'))).toBe('RUN#2025-12-');
    expect(runMonthSkPrefix(new Date('2026-01-01T00:00:00.000Z'))).toBe('RUN#2026-01-');
  });

  it('exports the GSI name and constant sort values', () => {
    expect(GSI1_NAME).toBe('gsi1');
    expect(USER_SK_PROFILE).toBe('PROFILE');
    expect(AGENT_GSI1SK_META).toBe('META');
  });
});
