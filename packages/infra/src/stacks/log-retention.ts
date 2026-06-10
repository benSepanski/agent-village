import { RetentionDays } from 'aws-cdk-lib/aws-logs';

export function toRetention(days: number): RetentionDays {
  if (days <= 1) return RetentionDays.ONE_DAY;
  if (days <= 3) return RetentionDays.THREE_DAYS;
  if (days <= 7) return RetentionDays.ONE_WEEK;
  if (days <= 14) return RetentionDays.TWO_WEEKS;
  if (days <= 30) return RetentionDays.ONE_MONTH;
  return RetentionDays.SIX_MONTHS;
}
