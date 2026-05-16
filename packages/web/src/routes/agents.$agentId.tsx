import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client/client.js';
import type { Agent, CreateAgentInputType, UpdateAgentInputType } from '../api-client/types.js';
import { AgentForm } from '../components/AgentForm.js';
import { SpendBar } from '../components/SpendBar.js';
import { StatusBadge } from '../components/StatusBadge.js';

function toPatch(input: CreateAgentInputType): UpdateAgentInputType {
  const patch: UpdateAgentInputType = {
    name: input.name,
    model: input.model,
    systemPrompt: input.systemPrompt,
    schedule: input.schedule,
    spendLimitUsd: input.spendLimitUsd,
  };
  if (input.anthropicApiKey !== '') patch.anthropicApiKey = input.anthropicApiKey;
  return patch;
}

function AgentActions({ agent }: { agent: Agent }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const togglePause = useMutation({
    mutationFn: (status: 'active' | 'paused') =>
      api.patch<Agent>(`/agents/${agent.id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
  const remove = useMutation({
    mutationFn: () => api.del<void>(`/agents/${agent.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      void navigate({ to: '/' });
    },
  });
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => togglePause.mutate(agent.status === 'active' ? 'paused' : 'active')}
      >
        {agent.status === 'active' ? 'Pause' : 'Resume'}
      </button>
      <button
        type="button"
        onClick={() => {
          if (confirm('Delete this agent? The Anthropic key is deleted too. Runs are kept.')) {
            remove.mutate();
          }
        }}
      >
        Delete
      </button>
    </div>
  );
}

export function AgentDetailPage() {
  const { agentId } = useParams({ from: '/agents/$agentId' });
  const qc = useQueryClient();
  const {
    data: agent,
    isPending,
    error,
  } = useQuery<Agent>({
    queryKey: ['agents', agentId],
    queryFn: () => api.get(`/agents/${agentId}`),
  });
  const updateMutation = useMutation({
    mutationFn: (patch: UpdateAgentInputType) => api.patch<Agent>(`/agents/${agentId}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
  if (isPending) return <p>Loading…</p>;
  if (error || !agent) return <p role="alert">Failed to load agent.</p>;
  return (
    <section>
      <header style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <h2>{agent.name}</h2>
        <StatusBadge status={agent.status} />
      </header>
      <p>
        <SpendBar spendUsedUsd={agent.spendUsedUsd} spendLimitUsd={agent.spendLimitUsd} />
      </p>
      <AgentActions agent={agent} />
      <h3>Edit</h3>
      <AgentForm
        mode="edit"
        initial={agent}
        submitLabel="Save changes"
        onSubmit={async (input) => {
          await updateMutation.mutateAsync(toPatch(input));
        }}
      />
      {/* Run history & timeline arrive in Step 12. */}
    </section>
  );
}
