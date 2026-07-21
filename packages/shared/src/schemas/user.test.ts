import { describe, expect, it } from 'vitest';
import { MAX_BUDGET_USD } from './spend-limits.js';
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

  // Finding C (1.0-verdict.md punch-list #3): `.positive()` alone accepts
  // Infinity and NaN, and has no upper bound.
  it('rejects Infinity and -Infinity', () => {
    expect(() => UserSchema.parse({ ...validUser, userMonthlyBudgetUsd: Infinity })).toThrow();
    expect(() => UserSchema.parse({ ...validUser, userMonthlyBudgetUsd: -Infinity })).toThrow();
  });

  it('rejects NaN', () => {
    expect(() => UserSchema.parse({ ...validUser, userMonthlyBudgetUsd: NaN })).toThrow();
  });

  it('rejects a value above the cap', () => {
    expect(() =>
      UserSchema.parse({ ...validUser, userMonthlyBudgetUsd: MAX_BUDGET_USD + 0.01 }),
    ).toThrow();
  });

  it('accepts a value exactly at the cap', () => {
    const parsed = UserSchema.parse({ ...validUser, userMonthlyBudgetUsd: MAX_BUDGET_USD });
    expect(parsed.userMonthlyBudgetUsd).toBe(MAX_BUDGET_USD);
  });

  it('round-trips through JSON without silently becoming a null budget', () => {
    // The bug this closes: JSON.stringify(Infinity) === 'null', so an
    // Infinity budget would previously "round-trip" into an *absent* cap
    // instead of failing loudly. Confirm Infinity never reaches that point.
    expect(() => UserSchema.parse({ ...validUser, userMonthlyBudgetUsd: Infinity })).toThrow();
    const withCap = { ...validUser, userMonthlyBudgetUsd: 50 };
    const roundTripped = JSON.parse(JSON.stringify(UserSchema.parse(withCap)));
    expect(UserSchema.parse(roundTripped).userMonthlyBudgetUsd).toBe(50);
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

  it('rejects Infinity, -Infinity, and NaN', () => {
    expect(() => UpdateUserInput.parse({ userMonthlyBudgetUsd: Infinity })).toThrow();
    expect(() => UpdateUserInput.parse({ userMonthlyBudgetUsd: -Infinity })).toThrow();
    expect(() => UpdateUserInput.parse({ userMonthlyBudgetUsd: NaN })).toThrow();
  });

  it('rejects a value above the cap but accepts one at the cap', () => {
    expect(() => UpdateUserInput.parse({ userMonthlyBudgetUsd: MAX_BUDGET_USD + 1 })).toThrow();
    expect(UpdateUserInput.parse({ userMonthlyBudgetUsd: MAX_BUDGET_USD })).toEqual({
      userMonthlyBudgetUsd: MAX_BUDGET_USD,
    });
  });

  it('rejects Infinity before it can silently become the ambiguous "clear the cap" null', () => {
    // The field is `.nullable()` so a real `null` legitimately clears the cap.
    // `JSON.stringify(Infinity) === 'null'`, so an Infinity budget that reached
    // JSON serialization anywhere upstream would be indistinguishable from an
    // intentional clear. `.finite()` rejects Infinity at THIS boundary, before
    // it can ever be serialized into that ambiguous null.
    expect(JSON.stringify({ userMonthlyBudgetUsd: Infinity })).toBe(
      '{"userMonthlyBudgetUsd":null}',
    );
    expect(() => UpdateUserInput.parse({ userMonthlyBudgetUsd: Infinity })).toThrow();
    // A real null is unaffected — clearing the cap still works.
    expect(UpdateUserInput.parse({ userMonthlyBudgetUsd: null })).toEqual({
      userMonthlyBudgetUsd: null,
    });
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
