import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AgentId, RunId } from '@agent-village/shared';
import { mintRunToken, parseRunToken, tokenHashMatches } from './gateway-token.js';

const AGENT_ID = AgentId.parse('01HZ1234567890ABCDEFGHJKMN');
const RUN_ID = RunId.parse('01HZN0PQRSTVWXYZ0123456789');

describe('mintRunToken / parseRunToken', () => {
  it('round-trips: a minted token parses back to its ids and matching hash', () => {
    const minted = mintRunToken(AGENT_ID, RUN_ID);
    const parsed = parseRunToken(minted.token);
    expect(parsed).not.toBeNull();
    expect(parsed?.agentId).toBe(AGENT_ID);
    expect(parsed?.runId).toBe(RUN_ID);
    expect(tokenHashMatches(parsed!.secretHash, minted.tokenHash)).toBe(true);
  });

  it('mints a unique secret per run', () => {
    const a = mintRunToken(AGENT_ID, RUN_ID);
    const b = mintRunToken(AGENT_ID, RUN_ID);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('never embeds the stored hash in the token itself', () => {
    const minted = mintRunToken(AGENT_ID, RUN_ID);
    expect(minted.token).not.toContain(minted.tokenHash);
  });

  it('rejects malformed tokens', () => {
    expect(parseRunToken('')).toBeNull();
    expect(parseRunToken('sk-ant-notaourtoken')).toBeNull();
    expect(parseRunToken(`wrongprefix.${AGENT_ID}.${RUN_ID}.abc`)).toBeNull();
    expect(parseRunToken(`avgw1.not-a-ulid.${RUN_ID}.abc`)).toBeNull();
    expect(parseRunToken(`avgw1.${AGENT_ID}.not-a-ulid.abc`)).toBeNull();
    expect(parseRunToken(`avgw1.${AGENT_ID}.${RUN_ID}.`)).toBeNull();
    expect(parseRunToken(`avgw1.${AGENT_ID}.${RUN_ID}`)).toBeNull();
  });
});

describe('tokenHashMatches', () => {
  const hash = (s: string): string => createHash('sha256').update(s).digest('hex');

  it('rejects a tampered secret', () => {
    const minted = mintRunToken(AGENT_ID, RUN_ID);
    expect(tokenHashMatches(hash('guessed-secret'), minted.tokenHash)).toBe(false);
  });

  it('rejects length-mismatched hashes without throwing', () => {
    expect(tokenHashMatches(hash('x'), 'abcd')).toBe(false);
  });
});
