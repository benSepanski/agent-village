import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api-client/client.js';
import type {
  Agent,
  CreateAgentInputType,
  Run,
  UpdateAgentInputType,
  UpdateUserInputType,
  User,
} from '../api-client/types.js';
import { AgentForm } from '../components/AgentForm.js';
import { ManifestSection } from '../components/ManifestSection.js';
import { MonthSpend } from '../components/MonthSpend.js';
import { PromptScratchpad } from '../components/PromptScratchpad.js';
import { RunControls } from '../components/RunControls.js';
import { RunHistoryTable } from '../components/RunHistoryTable.js';
import { SpendBar } from '../components/SpendBar.js';
import { StatusBadge } from '../components/StatusBadge.js';
import { UserBudget } from '../components/UserBudget.js';
import { UserBudgetForm } from '../components/UserBudgetForm.js';

interface RunNowResult {
  runId: string;
  status: string;
}

interface MonthSpendResult {
  month: string;
  costUsd: number;
  runCount: number;
}

interface AgentBudgetFigure {
  agentId: string;
  name: string;
  spendLimitUsd: number;
  spendUsedUsd: number;
}

/** GET /me/budget: the caller's live cap, current-month usage, and per-agent breakdown. */
interface BudgetStatus {
  month: string;
  limitUsd: number | null;
  usedUsd: number;
  remainingUsd: number | null;
  agents: AgentBudgetFigure[];
}

export function UserBudgetSection() {
  const qc = useQueryClient();
  const { data } = useQuery<BudgetStatus>({
    queryKey: ['me', 'budget'],
    queryFn: () => api.get('/me/budget'),
  });
  const updateBudget = useMutation({
    mutationFn: (patch: UpdateUserInputType) => api.patch<User>('/me/budget', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'budget'] }),
  });
  if (!data) return null;
  // updateBudget.error (rendered below) is the surface for failures here, so
  // mutateAsync's rejection is swallowed rather than re-thrown into
  // UserBudgetForm's unguarded `await onSave(...)`.
  const savePatch = async (patch: UpdateUserInputType): Promise<void> => {
    try {
      await updateBudget.mutateAsync(patch);
    } catch {
      // handled above via updateBudget.error
    }
  };
  return (
    <>
      <UserBudget limitUsd={data.limitUsd} usedUsd={data.usedUsd} />
      <UserBudgetForm
        initialLimitUsd={data.limitUsd}
        busy={updateBudget.isPending}
        onSave={(userMonthlyBudgetUsd) => savePatch({ userMonthlyBudgetUsd })}
        onClear={() => savePatch({ userMonthlyBudgetUsd: null })}
      />
      {updateBudget.error ? (
        <p role="alert">Failed: {(updateBudget.error as Error).message}</p>
      ) : null}
    </>
  );
}

function MonthSpendSection({ agentId }: { agentId: string }) {
  const { data } = useQuery<MonthSpendResult>({
    queryKey: ['agents', agentId, 'spend'],
    queryFn: () => api.get(`/agents/${agentId}/spend`),
  });
  if (!data) return null;
  return <MonthSpend month={data.month} costUsd={data.costUsd} runCount={data.runCount} />;
}

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

function AgentOverview({ agent }: { agent: Agent }) {
  return (
    <>
      <header style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
        <h2>{agent.name}</h2>
        <StatusBadge status={agent.status} />
      </header>
      <p>
        <SpendBar spendUsedUsd={agent.spendUsedUsd} spendLimitUsd={agent.spendLimitUsd} />
      </p>
      <p>
        <MonthSpendSection agentId={agent.id} />
      </p>
      <h3>Your monthly budget</h3>
      <UserBudgetSection />
      <AgentActions agent={agent} />
      <h3>Application manifest</h3>
      <ManifestSection agent={agent} />
    </>
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
      <AgentOverview agent={agent} />
      <RunNowSection agentId={agentId} />
      <h3>Recent runs</h3>
      <RunsSection agentId={agentId} />
      <h3>Edit</h3>
      <AgentForm
        mode="edit"
        initial={agent}
        submitLabel="Save changes"
        onSubmit={async (input) => {
          await updateMutation.mutateAsync(toPatch(input));
        }}
      />
      <h3>Prompt scratchpad</h3>
      <PromptScratchpad
        initialSystemPrompt={agent.systemPrompt}
        onRun={() => alert('Scratchpad backend lands in Phase 2 — prompt captured locally only.')}
        onSaveToAgent={async (systemPrompt) => {
          await updateMutation.mutateAsync({ systemPrompt });
        }}
      />
    </section>
  );
}

export function RunNowSection({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const runNow = useMutation({
    mutationFn: (opts: { dryRun: boolean }) =>
      api.post<RunNowResult>(`/agents/${agentId}/run-now`, opts),
    onSuccess: (res) =>
      navigate({ to: '/agents/$agentId/runs/$runId', params: { agentId, runId: res.runId } }),
  });
  return (
    <>
      <RunControls
        busy={runNow.isPending}
        onRun={(opts) => runNow.mutate({ dryRun: opts.dryRun })}
      />
      {runNow.error ? <p role="alert">Failed: {(runNow.error as Error).message}</p> : null}
    </>
  );
}

function RunsSection({ agentId }: { agentId: string }) {
  const { data, isPending, error } = useQuery<{ runs: Run[] }>({
    queryKey: ['agents', agentId, 'runs'],
    queryFn: () => api.get(`/agents/${agentId}/runs`),
  });
  if (isPending) return <p>Loading runs…</p>;
  if (error || !data) return <p role="alert">Failed to load runs.</p>;
  return <RunHistoryTable agentId={agentId} runs={data.runs} />;
}
