import { describe, expect, it } from 'vitest';
import { AgentId, RunId, UserId, zUlid } from './ids.js';

const VALID_ULID = '01HZ1234567890ABCDEFGHJKMN';
const VALID_ULID_2 = '01HZN0PQRSTVWXYZ0123456789';

describe('zUlid', () => {
  it('accepts a valid Crockford-base32 ULID', () => {
    expect(zUlid().parse(VALID_ULID)).toBe(VALID_ULID);
  });

  it('rejects strings of the wrong length', () => {
    expect(() => zUlid().parse('TOOSHORT')).toThrow();
    expect(() => zUlid().parse(`${VALID_ULID}EXTRA`)).toThrow();
  });

  it('rejects characters outside the Crockford base32 alphabet', () => {
    expect(() => zUlid().parse('01HZ1234567890ABCDEFGHIJKL')).toThrow(); // contains I
    expect(() => zUlid().parse('01HZ1234567890ABCDEFGHJKLO')).toThrow(); // contains O
    expect(() => zUlid().parse('01HZ1234567890ABCDEFGHJKLU')).toThrow(); // contains U
  });
});

describe('branded identifiers', () => {
  it('parses AgentId from a valid ULID', () => {
    expect(AgentId.parse(VALID_ULID)).toBe(VALID_ULID);
  });

  it('parses RunId from a valid ULID', () => {
    expect(RunId.parse(VALID_ULID_2)).toBe(VALID_ULID_2);
  });

  it('parses UserId from any non-empty string (Cognito sub)', () => {
    expect(UserId.parse('cog-abc-123')).toBe('cog-abc-123');
    expect(() => UserId.parse('')).toThrow();
  });
});
