import { describe, expect, it } from 'vitest';
import { validateCron } from './schedule.js';
import { InvalidScheduleError } from './errors.js';

describe('validateCron', () => {
  it('returns null for null input', () => {
    expect(validateCron(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(validateCron(undefined)).toBeNull();
  });

  it('returns null for blank/whitespace input', () => {
    expect(validateCron('')).toBeNull();
    expect(validateCron('   ')).toBeNull();
  });

  it('accepts a standard 5-field cron expression', () => {
    expect(validateCron('*/5 * * * *')).toBe('*/5 * * * *');
  });

  it('trims surrounding whitespace', () => {
    expect(validateCron('  0 12 * * *  ')).toBe('0 12 * * *');
  });

  it('accepts EventBridge cron(...) syntax', () => {
    const expr = 'cron(0 12 * * ? *)';
    expect(validateCron(expr)).toBe(expr);
  });

  it('accepts EventBridge rate(...) syntax', () => {
    expect(validateCron('rate(5 minutes)')).toBe('rate(5 minutes)');
  });

  it('rejects a 4-field cron', () => {
    expect(() => validateCron('* * * *')).toThrow(InvalidScheduleError);
  });

  it('rejects garbage input', () => {
    expect(() => validateCron('not a schedule')).toThrow(InvalidScheduleError);
  });

  it('rejects fields with disallowed characters', () => {
    expect(() => validateCron('*/5 * * * !')).toThrow(InvalidScheduleError);
  });
});
