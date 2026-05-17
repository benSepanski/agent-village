import { useNavigate } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client/client.js';
import type { Agent, CreateAgentInputType } from '../api-client/types.js';
import { AgentForm } from '../components/AgentForm.js';

export function AgentNewPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: CreateAgentInputType) => api.post<Agent>('/agents', input),
    onSuccess: (agent) => {
      void qc.invalidateQueries({ queryKey: ['agents'] });
      void navigate({ to: '/agents/$agentId', params: { agentId: agent.id } });
    },
  });
  return (
    <section>
      <h2>New agent</h2>
      <AgentForm
        mode="create"
        onSubmit={async (input) => {
          await mutation.mutateAsync(input);
        }}
      />
      {mutation.error ? <p role="alert">Failed: {(mutation.error as Error).message}</p> : null}
    </section>
  );
}
