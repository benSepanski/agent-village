import type { Agent } from '../api-client/types.js';
import { SpendBar } from './SpendBar.js';

export function SystemHealth({ agents }: { agents: Agent[] }) {
  const totalLimit = agents.reduce((s, a) => s + a.spendLimitUsd, 0);
  const totalUsed = agents.reduce((s, a) => s + a.spendUsedUsd, 0);
  const active = agents.filter((a) => a.status === 'active').length;
  const paused = agents.length - active;
  return (
    <section>
      <h2>System health</h2>
      <p>
        Agents: <strong>{agents.length}</strong> ({active} active, {paused} paused)
      </p>
      <p>Total spend used / limit:</p>
      <SpendBar spendUsedUsd={totalUsed} spendLimitUsd={totalLimit} />
    </section>
  );
}
