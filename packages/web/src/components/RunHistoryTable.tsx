import { Link } from '@tanstack/react-router';
import type { Run } from '../api-client/types.js';
import { StatusBadge } from './StatusBadge.js';

export function RunHistoryTable({ agentId, runs }: { agentId: string; runs: Run[] }) {
  if (runs.length === 0) return <p>No runs yet.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Started</th>
          <th>Status</th>
          <th>Cost</th>
          <th>Duration</th>
          <th>Tokens</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td>
              <Link to="/agents/$agentId/runs/$runId" params={{ agentId, runId: r.id }}>
                {r.createdAt}
              </Link>
            </td>
            <td>
              <StatusBadge status={r.status} />
            </td>
            <td>${r.costUsd.toFixed(4)}</td>
            <td>{r.durationMs}ms</td>
            <td>
              in={r.tokensIn} out={r.tokensOut}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
