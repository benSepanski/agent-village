import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client/client.js';
import type { Agent } from '../api-client/types.js';
import { AgentList } from '../components/AgentList.js';

export function AgentListPage() {
  const { data, isPending, error } = useQuery<{ agents: Agent[] }>({
    queryKey: ['agents'],
    queryFn: () => api.get('/agents'),
  });
  return (
    <section>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Agents</h2>
        <Link to="/agents/new">
          <button type="button">+ New agent</button>
        </Link>
      </header>
      {isPending ? <p>Loading…</p> : null}
      {error ? <p role="alert">Failed to load: {error.message}</p> : null}
      {data ? <AgentList agents={data.agents} /> : null}
    </section>
  );
}
