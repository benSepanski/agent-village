import { agentRepo, runRepo, secrets, type UserBudgetLeg } from '@agent-village/data';
import { actualCost, estimateGatewayCall, type TokenUsage } from '@agent-village/domain';
import { AnthropicModel, z, type Agent, type Run } from '@agent-village/shared';
import { classifySpendRejection } from './budget.js';
import { logger } from './logger.js';
import { parseRunToken, tokenHashMatches } from './gateway-token.js';
import { resolveCallBudget } from './gateway-budget.js';
import { MESSAGES_PATH, forwardToAnthropic, isUpstreamAbort } from './gateway-upstream.js';
import { extractUsage } from './gateway-usage.js';

// The upstream-call concern lives in gateway-upstream.ts; re-export its public
// surface so `services` consumers (and tests) keep importing it from here.
export {
  ANTHROPIC_UPSTREAM,
  MESSAGES_PATH,
  resolveUpstreamTimeoutMs,
  setGatewayFetch,
} from './gateway-upstream.js';
export type { GatewayFetch, UpstreamResponse } from './gateway-upstream.js';

/**
 * Anthropic metering gateway (ADR 0004). The sandbox app talks to this instead
 * of api.anthropic.com: it authenticates the per-run bearer token, RESERVES a
 * worst-case spend increment on the agent's ledger, forwards the call with the
 * platform-held key, then RECONCILES the reservation from the response usage —
 * the same reserve→reconcile invariant as the inline path
 * (docs/data-model/spend-reservation.md).
 */

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
/** nginx's "client closed request": a 4xx the Anthropic SDK does NOT auto-retry
 * (unlike 408/409/429 or any 5xx). Used for the in-flight deadline abort so a
 * generation Anthropic may have already billed server-side isn't paid twice by a
 * reflexive client retry. */
const HTTP_CLIENT_CLOSED_REQUEST = 499;
const HTTP_BAD_GATEWAY = 502;
const FIRST_NON_SUCCESS_STATUS = 300;
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

/**
 * `userBudget` is resolved once per gateway call (by the caller, from the
 * run's own persisted `budgetWindowKey` — never a freshly derived "now"
 * window) and threaded into BOTH this reservation and the eventual settle via
 * `CallContext.userWindowKey`, so the two legs always agree on whether the
 * window participated — see the settleWindowKey comment in
 * handleGatewayRequest for why re-resolving independently at settle time
 * would desync them.
 */
async function reserveOrReject(
  run: Run,
  agent: Agent,
  estimateUsd: number,
  userBudget: UserBudgetLeg | undefined,
): Promise<GatewayResponse | null> {
  try {
    await agentRepo.reserveSpend({
      agentId: agent.id,
      ownerSub: agent.ownerSub,
      estimateUsd,
      ...(userBudget !== undefined ? { userBudget } : {}),
    });
    logger.info({
      event: 'agent.run.spend_reserved',
      agentId: agent.id,
      runId: run.id,
      metric: { 'spend.reserved_usd': estimateUsd },
    });
    return null;
  } catch (err) {
    const kind = classifySpendRejection(err);
    if (!kind) throw err;
    logger.warn({
      event: kind === 'user_budget' ? 'gateway.run.budget_rejected' : 'agent.run.spend_rejected',
      agentId: agent.id,
      runId: run.id,
    });
    await markSpendExhausted(run);
    return errorResponse(
      HTTP_PAYMENT_REQUIRED,
      'billing_error',
      kind === 'user_budget'
        ? 'user monthly budget exceeded; call rejected by the metering gateway'
        : 'agent spend limit exceeded; call rejected by the metering gateway',
    );
  }
}

interface CallContext {
  run: Run;
  agent: Agent;
  model: AnthropicModel;
  estimateUsd: number;
  userWindowKey: string | undefined;
}

async function refundEstimate(ctx: CallContext): Promise<void> {
  await agentRepo.finalizeSpend({
    agentId: ctx.agent.id,
    ownerSub: ctx.agent.ownerSub,
    deltaUsd: -ctx.estimateUsd,
    ...(ctx.userWindowKey !== undefined ? { userWindowKey: ctx.userWindowKey } : {}),
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
  await agentRepo.finalizeSpend({
    agentId: ctx.agent.id,
    ownerSub: ctx.agent.ownerSub,
    deltaUsd,
    ...(ctx.userWindowKey !== undefined ? { userWindowKey: ctx.userWindowKey } : {}),
  });
  logger.info({
    event: 'gateway.call.reconciled',
    agentId: ctx.agent.id,
    runId: ctx.run.id,
    metric: { 'spend.actual_usd': costUsd, 'spend.delta_usd': deltaUsd },
  });
  await recordRunUsage(ctx, costUsd, usage);
}

/**
 * Turn an upstream fetch failure into a response, choosing the settlement
 * direction by cause. An in-flight deadline/timeout abort may already be billed
 * server-side, so it retains the worst-case reservation (safe for the cap) and
 * answers with a status the Anthropic SDK does not auto-retry — never inviting a
 * paid retry. A genuine connection failure never reached Anthropic, so it
 * refunds and returns the retryable 502.
 */
async function respondToUpstreamFailure(ctx: CallContext, err: unknown): Promise<GatewayResponse> {
  if (isUpstreamAbort(err)) {
    logger.error({
      event: 'gateway.call.deadline_aborted',
      agentId: ctx.agent.id,
      runId: ctx.run.id,
      err,
    });
    return errorResponse(
      HTTP_CLIENT_CLOSED_REQUEST,
      'timeout_error',
      'gateway aborted the generation at its time budget; not retried to avoid double billing',
    );
  }
  logger.error({
    event: 'gateway.call.upstream_failed',
    agentId: ctx.agent.id,
    runId: ctx.run.id,
    err,
  });
  await refundEstimate(ctx);
  return errorResponse(HTTP_BAD_GATEWAY, 'api_error', 'gateway could not reach the Anthropic API');
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
    return respondToUpstreamFailure(ctx, err);
  }
  logger.info({
    event: 'gateway.call.forwarded',
    agentId: ctx.agent.id,
    runId: ctx.run.id,
    upstreamStatus: upstream.status,
  });
  // Reconciliation is ledger bookkeeping AFTER a call Anthropic already billed.
  // If it throws (e.g. a DynamoDB throttle on finalizeSpend), the buffered
  // upstream response must still be returned: surfacing a 500 here makes the
  // sandbox SDK retry a successful, billed generation, multiplying real spend.
  // The worst-case reservation stays applied — the safe direction for the cap.
  try {
    await reconcile(ctx, upstream);
  } catch (err) {
    logger.error({
      event: 'gateway.call.reconcile_failed',
      agentId: ctx.agent.id,
      runId: ctx.run.id,
      err,
    });
  }
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
  const { userBudget, settleWindowKey } = await resolveCallBudget(auth.agent, auth.run);
  const rejected = await reserveOrReject(auth.run, auth.agent, estimateUsd, userBudget);
  if (rejected) return rejected;
  return forwardAndReconcile(
    {
      run: auth.run,
      agent: auth.agent,
      model: call.model,
      estimateUsd,
      userWindowKey: settleWindowKey,
    },
    req,
  );
}
