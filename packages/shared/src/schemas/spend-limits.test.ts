import { describe, expect, it } from 'vitest';
import { MAX_BUDGET_USD } from './spend-limits.js';

describe('MAX_BUDGET_USD', () => {
  it('is a positive, finite number', () => {
    expect(Number.isFinite(MAX_BUDGET_USD)).toBe(true);
    expect(MAX_BUDGET_USD).toBeGreaterThan(0);
  });
});
