export interface MonthSpendProps {
  /** UTC calendar month the summary covers, `YYYY-MM`. */
  month: string;
  costUsd: number;
  runCount: number;
}

/**
 * Month-to-date spend line for the agent page — summed live from the run
 * records of the current UTC month, so it shows actual (reconciled) cost, not
 * the lifetime `spendUsedUsd` ledger the SpendBar tracks.
 */
export function MonthSpend({ month, costUsd, runCount }: MonthSpendProps) {
  return (
    <span style={{ fontSize: '0.85em', color: '#374151' }}>
      This month ({month}): ${costUsd.toFixed(4)} across {runCount} run
      {runCount === 1 ? '' : 's'}
    </span>
  );
}
