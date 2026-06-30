import type { AgentStatus, RunStatus } from '@agent-village/shared';

type Status = AgentStatus | RunStatus;

const TONE: Record<Status, { bg: string; fg: string; label: string }> = {
  active: { bg: '#dcfce7', fg: '#166534', label: 'active' },
  paused: { bg: '#fef3c7', fg: '#92400e', label: 'paused' },
  ok: { bg: '#dcfce7', fg: '#166534', label: 'ok' },
  error: { bg: '#fee2e2', fg: '#991b1b', label: 'error' },
  spend_limit_exceeded: { bg: '#fee2e2', fg: '#991b1b', label: 'spend-limit' },
  running: { bg: '#dbeafe', fg: '#1e40af', label: 'running' },
  timed_out: { bg: '#fef3c7', fg: '#92400e', label: 'timed-out' },
  launch_failed: { bg: '#fee2e2', fg: '#991b1b', label: 'launch-failed' },
};

export function StatusBadge({ status }: { status: Status }) {
  const tone = TONE[status];
  return (
    <span
      style={{
        backgroundColor: tone.bg,
        color: tone.fg,
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '0.85em',
        fontWeight: 600,
      }}
    >
      {tone.label}
    </span>
  );
}
