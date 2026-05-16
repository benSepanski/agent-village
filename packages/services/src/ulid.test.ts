import { describe, expect, it } from 'vitest';
import { ulid } from './ulid.js';

describe('ulid', () => {
  it('returns 26 Crockford-base32 characters', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('returns distinct values across rapid calls', () => {
    const a = ulid();
    const b = ulid();
    expect(a).not.toBe(b);
  });

  it('encodes the supplied timestamp in the first 10 chars', () => {
    const a = ulid(0);
    const b = ulid(1);
    expect(a.slice(0, 10)).toBe('0000000000');
    expect(b.slice(0, 10)).toBe('0000000001');
  });
});
