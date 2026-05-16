import { useState } from 'react';

export interface RunControlsProps {
  onRun: (opts: { dryRun: boolean; replayOfRunId?: string }) => void | Promise<void>;
  replayOfRunId?: string;
  busy?: boolean;
}

export function RunControls({ onRun, replayOfRunId, busy = false }: RunControlsProps) {
  const [dryRun, setDryRun] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <button
        type="button"
        disabled={busy}
        onClick={() => void onRun(replayOfRunId ? { dryRun, replayOfRunId } : { dryRun })}
      >
        {replayOfRunId ? 'Replay' : 'Run now'}
      </button>
      <label>
        <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
        Dry run (cap max_tokens at 256)
      </label>
    </div>
  );
}
