import { Link } from '@tanstack/react-router';
import type { Agent } from '../api-client/types.js';
import { SpendBar } from './SpendBar.js';
import { StatusBadge } from './StatusBadge.js';

export function AgentList({ agents }: { agents: Agent[] }) {
  if (agents.length === 0) {
    return (
      <p>
        No agents yet — <Link to="/agents/new">create one</Link>.
      </p>
    );
  }
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Schedule</th>
          <th>Spend</th>
        </tr>
      </thead>
      <tbody>
        {agents.map((a) => (
          <tr key={a.id}>
            <td>
              <Link to="/agents/$agentId" params={{ agentId: a.id }}>
                {a.name}
              </Link>
            </td>
            <td>
              <StatusBadge status={a.status} />
            </td>
            <td>
              <code>{a.schedule ?? '— manual —'}</code>
            </td>
            <td>
              <SpendBar spendUsedUsd={a.spendUsedUsd} spendLimitUsd={a.spendLimitUsd} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
