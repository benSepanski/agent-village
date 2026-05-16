export interface SpendBarProps {
  spendUsedUsd: number;
  spendLimitUsd: number;
}

export function SpendBar({ spendUsedUsd, spendLimitUsd }: SpendBarProps) {
  const pct = spendLimitUsd <= 0 ? 0 : Math.min(100, (spendUsedUsd / spendLimitUsd) * 100);
  const tone = pct >= 90 ? '#dc2626' : pct >= 50 ? '#f59e0b' : '#16a34a';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <div
        role="progressbar"
        aria-valuenow={spendUsedUsd}
        aria-valuemin={0}
        aria-valuemax={spendLimitUsd}
        style={{
          width: 120,
          height: 8,
          background: '#e5e7eb',
          borderRadius: 4,
          overflow: 'hidden',
        }}
      >
        <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
      </div>
      <span style={{ fontSize: '0.85em', color: '#374151' }}>
        ${spendUsedUsd.toFixed(4)} / ${spendLimitUsd.toFixed(2)}
      </span>
    </div>
  );
}
