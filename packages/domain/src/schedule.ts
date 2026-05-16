import { InvalidScheduleError } from './errors.js';

const FIELD_CHARS = /^[\d*/,?\-LW#a-zA-Z]+$/;
const EB_CRON = /^cron\([^)]+\)$/;
const EB_RATE = /^rate\([^)]+\)$/;
const FIELD_COUNT_STANDARD = 5;

function isStandardFiveField(expr: string): boolean {
  const fields = expr.split(/\s+/);
  if (fields.length !== FIELD_COUNT_STANDARD) {
    return false;
  }
  return fields.every((f) => FIELD_CHARS.test(f));
}

/**
 * Validate and normalize a user-provided schedule expression.
 *
 * Accepts standard 5-field cron (`*\/5 * * * *`), EventBridge cron(...) and
 * rate(...) syntax. Returns the trimmed value, or `null` if the input is null
 * or whitespace. Throws `InvalidScheduleError` otherwise.
 */
export function validateCron(input: string | null | undefined): string | null {
  if (input === null || input === undefined) {
    return null;
  }
  const trimmed = input.trim();
  if (trimmed === '') {
    return null;
  }
  if (EB_CRON.test(trimmed) || EB_RATE.test(trimmed) || isStandardFiveField(trimmed)) {
    return trimmed;
  }
  throw new InvalidScheduleError(input);
}
