import { SpendBar } from './SpendBar.js';

export interface UserBudgetProps {
  /** `null` when the account has no monthly cap set (GET /me/budget). */
  limitUsd: number | null;
  /**
   * Current-month accumulator. May be a tiny negative number under drift
   * (see `UserBudgetWindowSchema`) — clamped to 0 here for display.
   */
  usedUsd: number;
}

/**
 * Account-wide monthly-budget line, shown alongside the per-agent SpendBar.
 * Mirrors SpendBar's look so the two read as one family.
 */
export function UserBudget({ limitUsd, usedUsd }: UserBudgetProps) {
  if (limitUsd === null) {
    return (
      <span style={{ fontSize: '0.85em', color: '#374151' }}>
        No monthly budget set for your account.
      </span>
    );
  }
  const used = Math.max(0, usedUsd);
  const remaining = Math.max(0, limitUsd - used);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <SpendBar spendUsedUsd={used} spendLimitUsd={limitUsd} />
      <span style={{ fontSize: '0.85em', color: '#374151' }}>
        ${remaining.toFixed(2)} remaining this month
      </span>
    </div>
  );
}
