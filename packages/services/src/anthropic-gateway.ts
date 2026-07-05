import { agentRepo, runRepo, secrets } from '@agent-village/data';
import {
  SpendLimitExceededError,
  actualCost,
  estimateGatewayCall,
  type TokenUsage,
} from '@agent-village/domain';
import { AnthropicModel, z, type Agent, type Run } from '@agent-village/shared';
import { logger } from './logger.js';
import { parseRunToken, tokenHashMatches } from './gateway-token.js';
import { extractUsage } from './gateway-usage.js';

/**
 * Anthropic metering gateway (ADR 0004). The sandbox app talks to this instead
 * of api.anthropic.com: it authenticates the per-run bearer token, RESERVES a
 * worst-case spend increment on the agent's ledger, forwards the call with the
 * platform-held key, then RECONCILES the reservation from the response usage —
 * the same reserve→reconcile invariant as the inline path
 * (docs/data-model/spend-reservation.md).
 */

export const ANTHROPIC_UPSTREAM = 'https://api.anthropic.com';
export const MESSAGES_PATH = '/v1/messages';

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_BAD_GATEWAY = 502;
const FIRST_NON_SUCCESS_STATUS = 300;
/** Upstream headers the sandbox's SDK sets that must survive the hop. */
const FORWARD_HEADER_NAMES = ['anthropic-version', 'anthropic-beta'];
/** Run statuses whose gateway token is still honored (task may still be alive). */
const ACTIVE_RUN_STATUSES: readonly string[] = ['running', 'spend_limit_exceeded'];

export interface GatewayRequest {
  method: string;
  path: string;
  /** Bearer token from `x-api-key` or `Authorization: Bearer …`; null if absent. */
  token: string | null;
  /** Raw request body text, forwarded verbatim upstream. */
  body: string;
  /** Lower-cased request headers. */
  headers: Record<string, string>;
  /**
   * Absolute epoch ms after which the upstream call must be aborted (the
   * Lambda deadline minus a settle buffer). Without it, an invocation killed
   * mid-await leaks the reservation: reserveSpend is a bare counter ADD whose
   * only compensations run inside this same invocation.
   */
  deadlineMs?: number;
}

export interface GatewayResponse {
  status: number;
  contentType: string;
  body: string;
}

/** Minimal structural slice of `fetch` so tests can inject a fake upstream. */
export interface UpstreamResponse {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export type GatewayFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<UpstreamResponse>;

let fetchOverride: GatewayFetch | undefined;

/** Test-only: inject (or clear with `undefined`) the upstream fetch. */
export function setGatewayFetch(fn: GatewayFetch | undefined): void {
  fetchOverride = fn;
}

// The platform-held Anthropic key, cached per secret ARN across invocations.
const keyCache = new Map<string, string>();

/** Test-only: drop cached Anthropic keys. */
export function resetGatewayKeyCache(): void {
  keyCache.clear();
}

async function platformKey(secretArn: string): Promise<string> {
  const cached = keyCache.get(secretArn);
  if (cached !== undefined) return cached;
  const key = await secrets.getAnthropicKey(secretArn);
  keyCache.set(secretArn, key);
  return key;
}

function errorResponse(status: number, type: string, message: string): GatewayResponse {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify({ type: 'error', error: { type, message } }),
  };
}

type AuthResult = { ok: true; run: Run; agent: Agent } | { ok: false; res: GatewayResponse };

function unauthorized(): AuthResult {
  logger.warn({ event: 'gateway.request.unauthorized' });
  return {
    ok: false,
    res: errorResponse(HTTP_UNAUTHORIZED, 'authentication_error', 'invalid gateway token'),
  };
}

async function authenticate(token: string | null): Promise<AuthResult> {
  const parsed = token === null ? null : parseRunToken(token);
  if (!parsed) return unauthorized();
  const run = await runRepo.getOne(parsed.agentId, parsed.runId);
  if (!run?.gatewayTokenHash || !tokenHashMatches(parsed.secretHash, run.gatewayTokenHash)) {
    return unauthorized();
  }
  if (!ACTIVE_RUN_STATUSES.includes(run.status)) {
    return {
      ok: false,
      res: errorResponse(HTTP_FORBIDDEN, 'permission_error', 'run is no longer active'),
    };
  }
  const agent = await agentRepo.getAgentById(run.agentId);
  if (!agent) return unauthorized();
  return { ok: true, run, agent };
}

const CallBodySchema = z.object({ model: z.string(), max_tokens: z.number().int().positive() });

interface ParsedCall {
  model: AnthropicModel;
  maxTokens: number;
}

function badRequest(message: string): GatewayResponse {
  logger.warn({ event: 'gateway.request.rejected', reason: message });
  return errorResponse(HTTP_BAD_REQUEST, 'invalid_request_error', message);
}

function parseCallBody(bodyText: string): ParsedCall | GatewayResponse {
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    return badRequest('request body must be JSON');
  }
  const body = CallBodySchema.safeParse(raw);
  if (!body.success) return badRequest('request body must include model and max_tokens');
  const model = AnthropicModel.safeParse(body.data.model);
  if (!model.success) {
    return badRequest(`model is not supported by the metering gateway: ${body.data.model}`);
  }
  return { model: model.data, maxTokens: body.data.max_tokens };
}

/** Mark the run so the breach survives task shutdown (lifecycle preserves it). */
async function markSpendExhausted(run: Run): Promise<void> {
  if (run.status === 'spend_limit_exceeded') return;
  try {
    await runRepo.patchRun(run.agentId, run.createdAt, run.id, {
      status: 'spend_limit_exceeded',
      error: 'spend limit exceeded mid-run; Anthropic calls rejected by the metering gateway',
    });
    logger.warn({ event: 'gateway.run.marked_exhausted', agentId: run.agentId, runId: run.id });
  } catch (err) {
    logger.error({ event: 'gateway.run.mark_failed', agentId: run.agentId, runId: run.id, err });
  }
}

async function reserveOrReject(
  run: Run,
  agent: Agent,
  estimateUsd: number,
): Promise<GatewayResponse | null> {
  try {
    await agentRepo.reserveSpend({ agentId: agent.id, ownerSub: agent.ownerSub, estimateUsd });
    logger.info({
      event: 'agent.run.spend_reserved',
      agentId: agent.id,
      runId: run.id,
      metric: { 'spend.reserved_usd': estimateUsd },
    });
    return null;
  } catch (err) {
    if (!(err instanceof SpendLimitExceededError)) throw err;
    logger.warn({ event: 'agent.run.spend_rejected', agentId: agent.id, runId: run.id });
    await markSpendExhausted(run);
    return errorResponse(
      HTTP_PAYMENT_REQUIRED,
      'billing_error',
      'agent spend limit exceeded; call rejected by the metering gateway',
    );
  }
}

async function forwardToAnthropic(req: GatewayRequest, apiKey: string): Promise<GatewayResponse> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
  };
  for (const name of FORWARD_HEADER_NAMES) {
    const value = req.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  // Abort before the Lambda deadline so the reservation is refunded inside
  // this invocation instead of leaking when the runtime kills us mid-await
  // (long generations can outlive the function timeout). The thrown abort is
  // handled by forwardAndReconcile's refund path.
  let signal: AbortSignal | undefined;
  if (req.deadlineMs !== undefined) {
    const budgetMs = req.deadlineMs - Date.now();
    if (budgetMs <= 0) throw new Error('gateway deadline exhausted before upstream call');
    signal = AbortSignal.timeout(budgetMs);
  }
  const doFetch: GatewayFetch = fetchOverride ?? ((url, init) => fetch(url, init));
  const res = await doFetch(`${ANTHROPIC_UPSTREAM}${MESSAGES_PATH}`, {
    method: 'POST',
    headers,
    body: req.body,
    ...(signal ? { signal } : {}),
  });
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? 'application/json',
    body: await res.text(),
  };
}

interface CallContext {
  run: Run;
  agent: Agent;
  model: AnthropicModel;
  estimateUsd: number;
}

async function refundEstimate(ctx: CallContext): Promise<void> {
  await agentRepo.finalizeSpend({
    agentId: ctx.agent.id,
    ownerSub: ctx.agent.ownerSub,
    deltaUsd: -ctx.estimateUsd,
  });
  logger.warn({ event: 'agent.run.spend_refunded', agentId: ctx.agent.id, runId: ctx.run.id });
}

// Best effort: run-record usage is observability, not the spend ledger.
async function recordRunUsage(ctx: CallContext, costUsd: number, usage: TokenUsage): Promise<void> {
  try {
    await runRepo.addRunUsage(ctx.run.agentId, ctx.run.createdAt, ctx.run.id, {
      costUsd,
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
    });
  } catch (err) {
    logger.warn({
      event: 'gateway.run.usage_record_failed',
      agentId: ctx.run.agentId,
      runId: ctx.run.id,
      err,
    });
  }
}

async function reconcile(ctx: CallContext, upstream: GatewayResponse): Promise<void> {
  if (upstream.status >= FIRST_NON_SUCCESS_STATUS) {
    // Failed call: nothing was consumed upstream that Anthropic bills us for.
    await refundEstimate(ctx);
    return;
  }
  const usage = extractUsage(upstream.contentType, upstream.body);
  if (!usage) {
    // Can't reconcile — keep the (worst-case) reservation rather than undercharge.
    logger.warn({
      event: 'gateway.call.usage_unparsed',
      agentId: ctx.agent.id,
      runId: ctx.run.id,
    });
    return;
  }
  const costUsd = actualCost(ctx.model, usage);
  const deltaUsd = costUsd - ctx.estimateUsd;
  await agentRepo.finalizeSpend({ agentId: ctx.agent.id, ownerSub: ctx.agent.ownerSub, deltaUsd });
  logger.info({
    event: 'gateway.call.reconciled',
    agentId: ctx.agent.id,
    runId: ctx.run.id,
    metric: { 'spend.actual_usd': costUsd, 'spend.delta_usd': deltaUsd },
  });
  await recordRunUsage(ctx, costUsd, usage);
}

async function forwardAndReconcile(
  ctx: CallContext,
  req: GatewayRequest,
): Promise<GatewayResponse> {
  let upstream: GatewayResponse;
  try {
    const apiKey = await platformKey(ctx.agent.anthropicSecretArn);
    upstream = await forwardToAnthropic(req, apiKey);
  } catch (err) {
    logger.error({
      event: 'gateway.call.upstream_failed',
      agentId: ctx.agent.id,
      runId: ctx.run.id,
      err,
    });
    await refundEstimate(ctx);
    return errorResponse(
      HTTP_BAD_GATEWAY,
      'api_error',
      'gateway could not reach the Anthropic API',
    );
  }
  logger.info({
    event: 'gateway.call.forwarded',
    agentId: ctx.agent.id,
    runId: ctx.run.id,
    upstreamStatus: upstream.status,
  });
  await reconcile(ctx, upstream);
  return upstream;
}

function normalizePath(path: string): string {
  return `/${path.split('/').filter(Boolean).join('/')}`;
}

export async function handleGatewayRequest(req: GatewayRequest): Promise<GatewayResponse> {
  if (req.method.toUpperCase() !== 'POST' || normalizePath(req.path) !== MESSAGES_PATH) {
    logger.warn({ event: 'gateway.request.rejected', reason: 'unsupported route', path: req.path });
    return errorResponse(
      HTTP_NOT_FOUND,
      'invalid_request_error',
      'the metering gateway only supports POST /v1/messages',
    );
  }
  const auth = await authenticate(req.token);
  if (!auth.ok) return auth.res;
  const call = parseCallBody(req.body);
  if ('status' in call) return call;
  const estimateUsd = estimateGatewayCall(call.model, call.maxTokens, req.body.length);
  const rejected = await reserveOrReject(auth.run, auth.agent, estimateUsd);
  if (rejected) return rejected;
  return forwardAndReconcile(
    { run: auth.run, agent: auth.agent, model: call.model, estimateUsd },
    req,
  );
}
