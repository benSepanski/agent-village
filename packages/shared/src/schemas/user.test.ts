import { describe, expect, it } from 'vitest';
import { UpdateUserInput, UserBudgetWindowSchema, UserSchema } from './user.js';

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

  it('defaults userMonthlyBudgetUsd to unset (no cap)', () => {
    const parsed = UserSchema.parse(validUser);
    expect(parsed.userMonthlyBudgetUsd).toBeUndefined();
  });

  it('accepts a positive userMonthlyBudgetUsd', () => {
    const parsed = UserSchema.parse({ ...validUser, userMonthlyBudgetUsd: 50 });
    expect(parsed.userMonthlyBudgetUsd).toBe(50);
  });

  it('rejects a zero or negative userMonthlyBudgetUsd', () => {
    expect(() => UserSchema.parse({ ...validUser, userMonthlyBudgetUsd: 0 })).toThrow();
    expect(() => UserSchema.parse({ ...validUser, userMonthlyBudgetUsd: -5 })).toThrow();
  });
});

describe('UpdateUserInput', () => {
  it('accepts a positive budget', () => {
    expect(UpdateUserInput.parse({ userMonthlyBudgetUsd: 25 })).toEqual({
      userMonthlyBudgetUsd: 25,
    });
  });

  it('accepts null to clear the cap', () => {
    expect(UpdateUserInput.parse({ userMonthlyBudgetUsd: null })).toEqual({
      userMonthlyBudgetUsd: null,
    });
  });

  it('accepts an empty object (omitted key leaves the cap untouched)', () => {
    expect(UpdateUserInput.parse({})).toEqual({});
  });

  it('rejects a zero or negative budget', () => {
    expect(() => UpdateUserInput.parse({ userMonthlyBudgetUsd: 0 })).toThrow();
    expect(() => UpdateUserInput.parse({ userMonthlyBudgetUsd: -1 })).toThrow();
  });
});

describe('UserBudgetWindowSchema', () => {
  const validWindow = {
    ownerSub: 'cog-sub-abc-123',
    month: '2026-07',
    spentUsd: 12.34,
    budgetLimitUsd: 50,
    updatedAt: '2026-07-16T12:00:00.000Z',
  };

  it('roundtrips a valid window', () => {
    expect(UserBudgetWindowSchema.parse(validWindow)).toEqual(validWindow);
  });

  it('rejects a malformed month label', () => {
    expect(() => UserBudgetWindowSchema.parse({ ...validWindow, month: '2026-7' })).toThrow();
    expect(() => UserBudgetWindowSchema.parse({ ...validWindow, month: 'July' })).toThrow();
  });

  it('rejects a non-positive budgetLimitUsd', () => {
    expect(() => UserBudgetWindowSchema.parse({ ...validWindow, budgetLimitUsd: 0 })).toThrow();
  });

  it('allows a slightly negative spentUsd (unconditional refund can dip below zero under drift)', () => {
    const parsed = UserBudgetWindowSchema.parse({ ...validWindow, spentUsd: -0.01 });
    expect(parsed.spentUsd).toBeCloseTo(-0.01);
  });
});
