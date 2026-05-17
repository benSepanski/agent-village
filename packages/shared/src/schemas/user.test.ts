import { describe, expect, it } from 'vitest';
import { UserSchema } from './user.js';

const validUser = {
  cognitoSub: 'cog-sub-abc-123',
  email: 'ben@example.com',
  displayName: 'Ben',
  createdAt: '2026-05-16T12:00:00.000Z',
};

describe('UserSchema', () => {
  it('roundtrips a valid user', () => {
    const parsed = UserSchema.parse(validUser);
    expect(parsed).toEqual(validUser);
  });

  it('rejects an invalid email', () => {
    expect(() => UserSchema.parse({ ...validUser, email: 'not-an-email' })).toThrow();
  });

  it('rejects an empty displayName', () => {
    expect(() => UserSchema.parse({ ...validUser, displayName: '' })).toThrow();
  });

  it('rejects a non-ISO createdAt', () => {
    expect(() => UserSchema.parse({ ...validUser, createdAt: 'yesterday' })).toThrow();
  });
});
