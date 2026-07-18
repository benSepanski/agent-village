/**
 * The gateway's upstream-call concern (ADR 0004): forwarding to api.anthropic.com
 * with the platform key under a configurable hard timeout, plus the abort
 * classification the reservation-settlement path depends on. Kept as a leaf
 * module (no import from anthropic-gateway) so the metering flow stays readable.
 */

export const ANTHROPIC_UPSTREAM = 'https://api.anthropic.com';
export const MESSAGES_PATH = '/v1/messages';

/** Upstream headers the sandbox's SDK sets that must survive the hop. */
const FORWARD_HEADER_NAMES = ['anthropic-version', 'anthropic-beta'];

/**
 * Hard cap (ms) on a single upstream generation before the gateway aborts it.
 * The Lambda deadline (runner-stack `GATEWAY_TIMEOUT_MINUTES`) still tightens
 * this when the runner supplies one; the default matches that 5-min timeout
 * minus the 10s deadline buffer. Raise it for long apply-bot web-search
 * generations via AV_GATEWAY_UPSTREAM_TIMEOUT_MS — but raising it past the Lambda
 * ceiling also needs GATEWAY_TIMEOUT_MINUTES bumped, or the runtime kills us
 * first.
 */
const DEFAULT_UPSTREAM_TIMEOUT_MS = 290_000;
const MIN_UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_UPSTREAM_TIMEOUT_MS = 900_000;

/** Resolve the configured upstream timeout, clamped to sane bounds. Exported for tests. */
export function resolveUpstreamTimeoutMs(): number {
  const raw = Number(process.env['AV_GATEWAY_UPSTREAM_TIMEOUT_MS'] ?? DEFAULT_UPSTREAM_TIMEOUT_MS);
  if (!Number.isFinite(raw)) return DEFAULT_UPSTREAM_TIMEOUT_MS;
  return Math.min(MAX_UPSTREAM_TIMEOUT_MS, Math.max(MIN_UPSTREAM_TIMEOUT_MS, raw));
}

/**
 * True when the upstream fetch was aborted by our deadline/timeout guard
 * (AbortSignal.timeout throws a `TimeoutError`; a manual abort throws
 * `AbortError`). Distinct from a connection failure (e.g. ECONNRESET) that never
 * reached Anthropic — that one refunds; an in-flight abort may already be billed
 * server-side, so it must NOT refund and must NOT invite a paid retry.
 */
export function isUpstreamAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

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

/** The subset of a gateway request the upstream forward needs. */
interface UpstreamCall {
  body: string;
  headers: Record<string, string>;
  deadlineMs?: number;
}

/** Buffered upstream result (structurally a GatewayResponse). */
export interface UpstreamResult {
  status: number;
  contentType: string;
  body: string;
}

export async function forwardToAnthropic(
  req: UpstreamCall,
  apiKey: string,
): Promise<UpstreamResult> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
  };
  for (const name of FORWARD_HEADER_NAMES) {
    const value = req.headers[name];
    if (value !== undefined) headers[name] = value;
  }
  // Bound the upstream call by the configurable hard timeout, tightened further
  // by the Lambda deadline when the runner supplies one. Aborting here settles
  // the reservation inside this invocation instead of leaking it when the
  // runtime kills us mid-await (long generations can outlive the timeout).
  // A pre-flight budget exhaustion never reached Anthropic (nothing billed) and
  // is handled by forwardAndReconcile's refund path; an in-flight AbortSignal
  // timeout may have billed server-side and is handled by its retain path.
  let budgetMs = resolveUpstreamTimeoutMs();
  if (req.deadlineMs !== undefined) {
    budgetMs = Math.min(budgetMs, req.deadlineMs - Date.now());
  }
  if (budgetMs <= 0) throw new Error('gateway deadline exhausted before upstream call');
  const signal = AbortSignal.timeout(budgetMs);
  const doFetch: GatewayFetch = fetchOverride ?? ((url, init) => fetch(url, init));
  const res = await doFetch(`${ANTHROPIC_UPSTREAM}${MESSAGES_PATH}`, {
    method: 'POST',
    headers,
    body: req.body,
    signal,
  });
  return {
    status: res.status,
    contentType: res.headers.get('content-type') ?? 'application/json',
    body: await res.text(),
  };
}
