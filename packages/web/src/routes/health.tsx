import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client/client.js';
import type { Agent } from '../api-client/types.js';
import { SystemHealth } from '../components/SystemHealth.js';

export function HealthPage() {
  const { data, isPending, error } = useQuery<{ agents: Agent[] }>({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents'),
  });
  if (isPending) return <p>Loading…</p>;
  if (error || !data) return <p role="alert">Failed to load health.</p>;
  return <SystemHealth agents={data.agents} />;
}
