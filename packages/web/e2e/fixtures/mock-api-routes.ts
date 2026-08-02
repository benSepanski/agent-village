import type { Page, Route } from '@playwright/test';
import {
  budgetUsedUsd,
  createAgent,
  createRun,
  deleteAgent,
  listRuns,
  updateAgent,
  updateUserBudget,
  type MockApiState,
} from './mock-api-state.js';

/** GET /me/budget response shape (routes/agents.$agentId.tsx BudgetStatus). */
function budgetStatus(state: MockApiState) {
  const limitUsd = state.budgetLimitUsd;
  const usedUsd = budgetUsedUsd(state);
  return {
    month: new Date().toISOString().slice(0, 7),
    limitUsd,
    usedUsd,
    remainingUsd: limitUsd === null ? null : Math.max(0, limitUsd - usedUsd),
    agents: [...state.agents.values()].map((a) => ({
      agentId: a.id,
      name: a.name,
      spendLimitUsd: a.spendLimitUsd,
      spendUsedUsd: a.spendUsedUsd,
    })),
  };
}

async function handleAgentsCollection(route: Route, state: MockApiState): Promise<void> {
  const method = route.request().method();
  if (method === 'GET') {
    await route.fulfill({ json: { agents: [...state.agents.values()] } });
    return;
  }
  if (method === 'POST') {
    const input = route.request().postDataJSON();
    const agent = createAgent(state, input);
    await route.fulfill({ status: 201, json: agent });
    return;
  }
  await route.fulfill({ status: 405, json: { error: 'unsupported method' } });
}

async function handleAgentGet(route: Route, state: MockApiState, agentId: string): Promise<void> {
  const agent = state.agents.get(agentId);
  if (!agent) {
    await route.fulfill({ status: 404, json: { error: 'not found' } });
    return;
  }
  await route.fulfill({ json: agent });
}

async function handleAgentPatch(route: Route, state: MockApiState, agentId: string): Promise<void> {
  const updated = updateAgent(state, agentId, route.request().postDataJSON());
  if (!updated) {
    await route.fulfill({ status: 404, json: { error: 'not found' } });
    return;
  }
  await route.fulfill({ json: updated });
}

async function handleAgentDelete(
  route: Route,
  state: MockApiState,
  agentId: string,
): Promise<void> {
  deleteAgent(state, agentId);
  await route.fulfill({ status: 204, body: '' });
}

async function handleAgentItem(route: Route, state: MockApiState, agentId: string): Promise<void> {
  const method = route.request().method();
  if (method === 'GET') return handleAgentGet(route, state, agentId);
  if (method === 'PATCH') return handleAgentPatch(route, state, agentId);
  if (method === 'DELETE') return handleAgentDelete(route, state, agentId);
  await route.fulfill({ status: 405, json: { error: 'unsupported method' } });
}

async function handleRunNow(route: Route, state: MockApiState, agentId: string): Promise<void> {
  const opts = route.request().postDataJSON() as { dryRun?: boolean; replayOfRunId?: string };
  const run = createRun(state, agentId, { dryRun: opts.dryRun ?? false, ...opts });
  if (!run) {
    await route.fulfill({ status: 404, json: { error: 'no such agent' } });
    return;
  }
  await route.fulfill({ json: { runId: run.id, status: run.status } });
}

async function handleRuns(route: Route, state: MockApiState, agentId: string): Promise<void> {
  await route.fulfill({ json: { runs: listRuns(state, agentId) } });
}

async function handleRunItem(route: Route, state: MockApiState, runId: string): Promise<void> {
  const run = state.runs.get(runId);
  if (!run) {
    await route.fulfill({ status: 404, json: { error: 'not found' } });
    return;
  }
  await route.fulfill({ json: run });
}

async function handleSpend(route: Route, state: MockApiState, agentId: string): Promise<void> {
  const runs = listRuns(state, agentId);
  const costUsd = runs.reduce((sum, r) => sum + r.costUsd, 0);
  await route.fulfill({
    json: { month: new Date().toISOString().slice(0, 7), costUsd, runCount: runs.length },
  });
}

async function handleMeBudget(route: Route, state: MockApiState): Promise<void> {
  const method = route.request().method();
  if (method === 'PATCH') {
    const patch = route.request().postDataJSON() as { userMonthlyBudgetUsd?: number | null };
    if (Object.prototype.hasOwnProperty.call(patch, 'userMonthlyBudgetUsd')) {
      updateUserBudget(state, patch.userMonthlyBudgetUsd ?? null);
    }
    await route.fulfill({ json: { ownerSub: state.ownerSub } });
    return;
  }
  await route.fulfill({ json: budgetStatus(state) });
}

/** `/agents/:agentId/...` sub-paths, longest/most-specific first. */
function routeAgentSubpath(route: Route, state: MockApiState, rest: string[]): Promise<void> {
  const [agentId, segment, third] = rest;
  if (agentId === undefined) return handleAgentsCollection(route, state);
  if (segment === undefined) return handleAgentItem(route, state, agentId);
  if (segment === 'run-now') return handleRunNow(route, state, agentId);
  if (segment === 'spend') return handleSpend(route, state, agentId);
  if (segment === 'runs' && third === undefined) return handleRuns(route, state, agentId);
  if (segment === 'runs' && third !== undefined) return handleRunItem(route, state, third);
  return route.fulfill({ status: 404, json: { error: 'unknown route' } });
}

function dispatch(route: Route, state: MockApiState): Promise<void> {
  const pathname = new URL(route.request().url()).pathname;
  if (pathname === '/me/budget') return handleMeBudget(route, state);
  const rest = pathname
    .replace(/^\/agents\/?/, '')
    .split('/')
    .filter(Boolean);
  return routeAgentSubpath(route, state, rest);
}

/**
 * Registers a single Playwright route covering every `/agents*` and
 * `/me/budget` endpoint the routed UI calls, backed by an in-memory
 * `MockApiState`. Fulfills entirely — never falls through to the network.
 */
export async function installApiStubs(page: Page, state: MockApiState): Promise<void> {
  await page.route(
    (url) =>
      url.pathname === '/agents' ||
      url.pathname.startsWith('/agents/') ||
      url.pathname === '/me/budget',
    (route) => dispatch(route, state),
  );
}
