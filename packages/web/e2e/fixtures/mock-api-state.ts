import type {
  Agent,
  AgentId,
  CreateAgentInputType,
  Run,
  RunId,
  UpdateAgentInputType,
  UserId,
} from '../../src/api-client/types.js';

/**
 * In-memory backing store for the mocked `/agents`, `/agents/:id/runs`, and
 * `/me/budget` endpoints (M4 E2E-WEB). One instance per test — created fresh
 * by the `authedTest` fixture so runs never leak across specs.
 */
export interface MockApiState {
  agents: Map<string, Agent>;
  runs: Map<string, Run>;
  runsByAgent: Map<string, string[]>;
  ownerSub: string;
  nextId: () => string;
  /** Account-wide monthly cap (GET/PATCH /me/budget). `null` = no cap set. */
  budgetLimitUsd: number | null;
}

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Generates a 26-char Crockford-base32 string shaped like a real ULID. */
function makeIdGenerator(): () => string {
  let counter = 0;
  return () => {
    counter += 1;
    const seed =
      `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2)}`.padEnd(
        26,
        '0',
      );
    let out = '';
    for (let i = 0; i < 26; i += 1) {
      out += CROCKFORD_ALPHABET[seed.charCodeAt(i % seed.length) % CROCKFORD_ALPHABET.length];
    }
    return out;
  };
}

export function createMockApiState(ownerSub = 'e2e-user'): MockApiState {
  return {
    agents: new Map(),
    runs: new Map(),
    runsByAgent: new Map(),
    ownerSub,
    nextId: makeIdGenerator(),
    budgetLimitUsd: null,
  };
}

/** Account-wide current-month accumulator: the sum of every recorded run's cost. */
export function budgetUsedUsd(state: MockApiState): number {
  let total = 0;
  for (const run of state.runs.values()) total += run.costUsd;
  return total;
}

/** Applies PATCH /me/budget: a number sets the cap, `null` clears it. */
export function updateUserBudget(state: MockApiState, userMonthlyBudgetUsd: number | null): void {
  state.budgetLimitUsd = userMonthlyBudgetUsd;
}

/** Deterministic stand-in for the real server's system-prompt hash. */
export function promptHash(systemPrompt: string): string {
  let hash = 0;
  for (let i = 0; i < systemPrompt.length; i += 1) {
    hash = (hash * 31 + systemPrompt.charCodeAt(i)) >>> 0;
  }
  return `sha256:${hash.toString(16).padStart(8, '0')}`;
}

export function createAgent(state: MockApiState, input: CreateAgentInputType): Agent {
  const id = state.nextId();
  const now = new Date().toISOString();
  const agent: Agent = {
    id: id as AgentId,
    ownerSub: state.ownerSub as UserId,
    name: input.name,
    model: input.model,
    systemPrompt: input.systemPrompt,
    schedule: input.schedule,
    spendLimitUsd: input.spendLimitUsd,
    spendUsedUsd: 0,
    anthropicSecretArn: `arn:aws:secretsmanager:mock:agent/${id}`,
    status: input.status ?? 'active',
    manifest: input.manifest ?? null,
    activeRunId: null,
    sandboxTaskDef: null,
    createdAt: now,
    updatedAt: now,
  };
  state.agents.set(id, agent);
  state.runsByAgent.set(id, []);
  return agent;
}

/** Applies only the fields present in `patch` — a bare `{...existing, ...patch}`
 * spread would widen every field to `T | undefined` since `patch` is a
 * `Partial<Agent>`-shaped input. */
export function updateAgent(
  state: MockApiState,
  agentId: string,
  patch: UpdateAgentInputType,
): Agent | null {
  const existing = state.agents.get(agentId);
  if (!existing) return null;
  const updated: Agent = { ...existing };
  if (patch.name !== undefined) updated.name = patch.name;
  if (patch.model !== undefined) updated.model = patch.model;
  if (patch.systemPrompt !== undefined) updated.systemPrompt = patch.systemPrompt;
  if (patch.schedule !== undefined) updated.schedule = patch.schedule;
  if (patch.spendLimitUsd !== undefined) updated.spendLimitUsd = patch.spendLimitUsd;
  if (patch.status !== undefined) updated.status = patch.status;
  if (patch.manifest !== undefined) updated.manifest = patch.manifest;
  updated.updatedAt = new Date().toISOString();
  state.agents.set(agentId, updated);
  return updated;
}

export function deleteAgent(state: MockApiState, agentId: string): boolean {
  state.runsByAgent.delete(agentId);
  return state.agents.delete(agentId);
}

export interface RunNowOptions {
  dryRun: boolean;
  replayOfRunId?: string;
}

export function createRun(state: MockApiState, agentId: string, opts: RunNowOptions): Run | null {
  const agent = state.agents.get(agentId);
  if (!agent) return null;
  const id = state.nextId();
  const now = new Date().toISOString();
  const run: Run = {
    id: id as RunId,
    agentId: agentId as AgentId,
    ownerSub: state.ownerSub as UserId,
    status: 'ok',
    kind: 'inline',
    costUsd: 0.0021,
    tokensIn: 128,
    tokensOut: 256,
    output: 'mock run output',
    error: null,
    durationMs: 842,
    traceId: `trace-${id}`,
    model: agent.model,
    systemPromptHash: promptHash(agent.systemPrompt),
    dryRun: opts.dryRun,
    replayOfRunId: (opts.replayOfRunId as RunId | undefined) ?? null,
    taskArn: null,
    exitCode: null,
    gatewayTokenHash: null,
    reservedUsd: null,
    events: [
      { event: 'agent.run.started', at: now },
      { event: 'agent.run.completed', at: now },
    ],
    budgetWindowKey: null,
    createdAt: now,
  };
  state.runs.set(id, run);
  const list = state.runsByAgent.get(agentId) ?? [];
  list.unshift(id);
  state.runsByAgent.set(agentId, list);
  return run;
}

export function listRuns(state: MockApiState, agentId: string): Run[] {
  const ids = state.runsByAgent.get(agentId) ?? [];
  return ids.map((id) => state.runs.get(id)).filter((r): r is Run => r !== undefined);
}
