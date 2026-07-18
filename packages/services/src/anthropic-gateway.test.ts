import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpendLimitExceededError, actualCost, estimateGatewayCall } from '@agent-village/domain';
import { AgentId, RunId } from '@agent-village/shared';

const { agentRepoMock, runRepoMock, secretsMock } = vi.hoisted(() => ({
  agentRepoMock: { getAgentById: vi.fn(), reserveSpend: vi.fn(), finalizeSpend: vi.fn() },
  runRepoMock: { getOne: vi.fn(), patchRun: vi.fn(), addRunUsage: vi.fn() },
  secretsMock: { getAnthropicKey: vi.fn() },
}));

vi.mock('@agent-village/data', () => ({
  agentRepo: agentRepoMock,
  runRepo: runRepoMock,
  secrets: secretsMock,
  userRepo: {},
}));

import {
  handleGatewayRequest,
  resetGatewayKeyCache,
  setGatewayFetch,
  type GatewayRequest,
} from './anthropic-gateway.js';
import { mintRunToken } from './gateway-token.js';

const AGENT_ID = AgentId.parse('01HZ1234567890ABCDEFGHJKMN');
const RUN_ID = RunId.parse('01HZN0PQRSTVWXYZ0123456789');
const SUB = 'cog-sub-abc';
const SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:0:secret:anthropic-key';
const MODEL = 'claude-sonnet-4-6';

const minted = mintRunToken(AGENT_ID, RUN_ID);

const runFixture = {
  id: RUN_ID,
  agentId: AGENT_ID,
  ownerSub: SUB,
  status: 'running',
  kind: 'sandbox',
  gatewayTokenHash: minted.tokenHash,
  createdAt: '2026-07-03T12:00:00.000Z',
};

const agentFixture = {
  id: AGENT_ID,
  ownerSub: SUB,
  anthropicSecretArn: SECRET_ARN,
  spendLimitUsd: 1,
  spendUsedUsd: 0,
};

const requestBody = JSON.stringify({
  model: MODEL,
  max_tokens: 500,
  messages: [{ role: 'user', content: 'hello' }],
});

const request = (overrides: Partial<GatewayRequest> = {}): GatewayRequest => ({
  method: 'POST',
  path: '/v1/messages',
  token: minted.token,
  body: requestBody,
  headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  ...overrides,
});

const okUpstreamBody = JSON.stringify({
  id: 'msg_x',
  content: [{ type: 'text', text: 'hi' }],
  usage: { input_tokens: 100, output_tokens: 40 },
});

const fetchMock = vi.fn();

function upstream(status: number, body: string, contentType = 'application/json'): void {
  fetchMock.mockResolvedValue({
    status,
    headers: { get: (name: string) => (name === 'content-type' ? contentType : null) },
    text: async () => body,
  });
}

beforeEach(() => {
  for (const repo of [agentRepoMock, runRepoMock, secretsMock]) {
    Object.values(repo).forEach((m) => m.mockReset());
  }
  fetchMock.mockReset();
  setGatewayFetch(fetchMock);
  resetGatewayKeyCache();
  runRepoMock.getOne.mockResolvedValue(runFixture);
  runRepoMock.patchRun.mockResolvedValue(undefined);
  runRepoMock.addRunUsage.mockResolvedValue(undefined);
  agentRepoMock.getAgentById.mockResolvedValue(agentFixture);
  agentRepoMock.reserveSpend.mockResolvedValue(undefined);
  agentRepoMock.finalizeSpend.mockResolvedValue(undefined);
  secretsMock.getAnthropicKey.mockResolvedValue('sk-ant-platform');
  upstream(200, okUpstreamBody);
});

const expectedEstimate = estimateGatewayCall(MODEL, 500, requestBody.length);

describe('handleGatewayRequest — auth', () => {
  it('rejects a missing token with 401 and never touches the ledger', async () => {
    const res = await handleGatewayRequest(request({ token: null }));
    expect(res.status).toBe(401);
    expect(agentRepoMock.reserveSpend).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a token whose secret does not match the stored hash', async () => {
    const forged = `avgw1.${AGENT_ID}.${RUN_ID}.${'ab'.repeat(32)}`;
    const res = await handleGatewayRequest(request({ token: forged }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a token for a run with no gatewayTokenHash', async () => {
    runRepoMock.getOne.mockResolvedValue({ ...runFixture, gatewayTokenHash: null });
    const res = await handleGatewayRequest(request());
    expect(res.status).toBe(401);
  });

  it('rejects a token whose run already reached a terminal status', async () => {
    runRepoMock.getOne.mockResolvedValue({ ...runFixture, status: 'ok' });
    const res = await handleGatewayRequest(request());
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when the agent no longer exists', async () => {
    agentRepoMock.getAgentById.mockResolvedValue(null);
    const res = await handleGatewayRequest(request());
    expect(res.status).toBe(401);
  });
});

describe('handleGatewayRequest — routing and body validation', () => {
  it('404s any route other than POST /v1/messages', async () => {
    expect((await handleGatewayRequest(request({ path: '/v1/models' }))).status).toBe(404);
    expect((await handleGatewayRequest(request({ method: 'GET' }))).status).toBe(404);
  });

  it('accepts a trailing-slash path variant', async () => {
    const res = await handleGatewayRequest(request({ path: '/v1/messages/' }));
    expect(res.status).toBe(200);
  });

  it('400s a non-JSON body', async () => {
    const res = await handleGatewayRequest(request({ body: 'nope' }));
    expect(res.status).toBe(400);
    expect(agentRepoMock.reserveSpend).not.toHaveBeenCalled();
  });

  it('400s a model missing from the pricing table instead of passing it unmetered', async () => {
    const body = JSON.stringify({ model: 'claude-unknown-9', max_tokens: 10, messages: [] });
    const res = await handleGatewayRequest(request({ body }));
    expect(res.status).toBe(400);
    expect(res.body).toContain('claude-unknown-9');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('handleGatewayRequest — reserve → forward → reconcile', () => {
  it('reserves the worst-case estimate before forwarding', async () => {
    await handleGatewayRequest(request());
    expect(agentRepoMock.reserveSpend).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      ownerSub: SUB,
      estimateUsd: expectedEstimate,
    });
    const reserveOrder = agentRepoMock.reserveSpend.mock.invocationCallOrder[0]!;
    const fetchOrder = fetchMock.mock.invocationCallOrder[0]!;
    expect(reserveOrder).toBeLessThan(fetchOrder);
  });

  it('forwards to api.anthropic.com with the platform key, never the run token', async () => {
    await handleGatewayRequest(request());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(requestBody);
    expect(init.headers['x-api-key']).toBe('sk-ant-platform');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.stringify(init.headers)).not.toContain(minted.token);
  });

  it('returns the upstream body and reconciles the ledger from real usage', async () => {
    const res = await handleGatewayRequest(request());
    expect(res.status).toBe(200);
    expect(res.body).toBe(okUpstreamBody);
    const costUsd = actualCost(MODEL, { inputTokens: 100, outputTokens: 40 });
    expect(agentRepoMock.finalizeSpend).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      ownerSub: SUB,
      deltaUsd: costUsd - expectedEstimate,
    });
    expect(runRepoMock.addRunUsage).toHaveBeenCalledWith(AGENT_ID, runFixture.createdAt, RUN_ID, {
      costUsd,
      tokensIn: 100,
      tokensOut: 40,
    });
  });

  it('caches the platform key across calls', async () => {
    await handleGatewayRequest(request());
    await handleGatewayRequest(request());
    expect(secretsMock.getAnthropicKey).toHaveBeenCalledTimes(1);
  });

  it('refunds the full estimate when upstream returns an error status', async () => {
    upstream(429, JSON.stringify({ type: 'error', error: { type: 'rate_limit_error' } }));
    const res = await handleGatewayRequest(request());
    expect(res.status).toBe(429);
    expect(agentRepoMock.finalizeSpend).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      ownerSub: SUB,
      deltaUsd: -expectedEstimate,
    });
    expect(runRepoMock.addRunUsage).not.toHaveBeenCalled();
  });

  it('refunds and returns 502 when the upstream fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const res = await handleGatewayRequest(request());
    expect(res.status).toBe(502);
    expect(agentRepoMock.finalizeSpend).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      ownerSub: SUB,
      deltaUsd: -expectedEstimate,
    });
  });

  it('refunds and 502s instead of forwarding when the Lambda deadline is exhausted', async () => {
    // An invocation killed mid-await would leak the reservation (no
    // out-of-band compensation exists) — the deadline guard refunds inside
    // the invocation instead.
    const res = await handleGatewayRequest(request({ deadlineMs: Date.now() - 1 }));
    expect(res.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(agentRepoMock.finalizeSpend).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      ownerSub: SUB,
      deltaUsd: -expectedEstimate,
    });
  });

  it('passes an abort signal bounded by the deadline to the upstream fetch', async () => {
    upstream(200, JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }));
    await handleGatewayRequest(request({ deadlineMs: Date.now() + 60_000 }));
    const init = fetchMock.mock.calls[0]![1] as { signal?: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('keeps the reservation (no finalize) when a 2xx body has no parseable usage', async () => {
    upstream(200, '{"weird": true}');
    const res = await handleGatewayRequest(request());
    expect(res.status).toBe(200);
    expect(agentRepoMock.finalizeSpend).not.toHaveBeenCalled();
  });

  it('reconciles from a buffered SSE stream response', async () => {
    const sse = [
      `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 7 } } })}`,
      `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 21 } })}`,
    ].join('\n');
    upstream(200, sse, 'text/event-stream; charset=utf-8');
    await handleGatewayRequest(request());
    const costUsd = actualCost(MODEL, { inputTokens: 7, outputTokens: 21 });
    expect(agentRepoMock.finalizeSpend).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      ownerSub: SUB,
      deltaUsd: costUsd - expectedEstimate,
    });
  });

  it('still returns the billed 200 response when reconcile bookkeeping throws', async () => {
    // Regression (F6): the upstream call already billed Anthropic. A DynamoDB
    // failure while reconciling must NOT surface as a 500 — that makes the
    // sandbox SDK retry a successful generation and double real spend. The
    // worst-case reservation stays applied (safe direction for the cap).
    agentRepoMock.finalizeSpend.mockRejectedValue(new Error('DynamoDB throttled'));
    const res = await handleGatewayRequest(request());
    expect(res.status).toBe(200);
    expect(res.body).toBe(okUpstreamBody);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('handleGatewayRequest — exhaustion', () => {
  const limitError = new SpendLimitExceededError({
    agentId: AGENT_ID,
    spendLimitUsd: 1,
    spendUsedUsd: 1,
    estimateUsd: expectedEstimate,
  });

  it('returns 402 with an Anthropic-shaped billing error and never forwards', async () => {
    agentRepoMock.reserveSpend.mockRejectedValue(limitError);
    const res = await handleGatewayRequest(request());
    expect(res.status).toBe(402);
    const body = JSON.parse(res.body) as { type: string; error: { type: string } };
    expect(body.type).toBe('error');
    expect(body.error.type).toBe('billing_error');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks the run spend_limit_exceeded on the first breach', async () => {
    agentRepoMock.reserveSpend.mockRejectedValue(limitError);
    await handleGatewayRequest(request());
    expect(runRepoMock.patchRun).toHaveBeenCalledWith(
      AGENT_ID,
      runFixture.createdAt,
      RUN_ID,
      expect.objectContaining({ status: 'spend_limit_exceeded' }),
    );
  });

  it('does not re-patch a run already marked spend_limit_exceeded, but still 402s', async () => {
    runRepoMock.getOne.mockResolvedValue({ ...runFixture, status: 'spend_limit_exceeded' });
    agentRepoMock.reserveSpend.mockRejectedValue(limitError);
    const res = await handleGatewayRequest(request());
    expect(res.status).toBe(402);
    expect(runRepoMock.patchRun).not.toHaveBeenCalled();
  });

  it('still answers 402 if marking the run fails', async () => {
    agentRepoMock.reserveSpend.mockRejectedValue(limitError);
    runRepoMock.patchRun.mockRejectedValue(new Error('ddb down'));
    const res = await handleGatewayRequest(request());
    expect(res.status).toBe(402);
  });
});
