import { createLogger, z } from '@agent-village/shared';
import { gateway } from '@agent-village/services';

/**
 * Lambda function-URL front for the Anthropic metering gateway (ADR 0004).
 * Auth is NOT the function URL (AuthType NONE) — it is the per-run bearer
 * token validated inside `gateway.handleGatewayRequest`.
 */

const logger: ReturnType<typeof createLogger> = createLogger({
  env: process.env['AV_ENV'] ?? 'dev',
  service: 'anthropic-gateway',
});

/** Function-URL (HTTP API payload v2) envelope — just the fields we consume. */
const FunctionUrlEventSchema = z.object({
  rawPath: z.string().default('/'),
  headers: z.record(z.string()).default({}),
  requestContext: z.object({ http: z.object({ method: z.string() }) }),
  body: z.string().optional(),
  isBase64Encoded: z.boolean().default(false),
});

interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const BEARER_PREFIX = /^bearer\s+/i;

function lowerCaseHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
}

/** The Anthropic SDK sends `x-api-key`; `Authorization: Bearer` also accepted. */
function tokenFrom(headers: Record<string, string>): string | null {
  const apiKey = headers['x-api-key'];
  if (apiKey) return apiKey;
  const auth = headers['authorization'];
  return auth && BEARER_PREFIX.test(auth) ? auth.replace(BEARER_PREFIX, '') : null;
}

function decodeBody(body: string | undefined, isBase64: boolean): string {
  if (body === undefined) return '';
  return isBase64 ? Buffer.from(body, 'base64').toString('utf8') : body;
}

const INTERNAL_ERROR_BODY = JSON.stringify({
  type: 'error',
  error: { type: 'api_error', message: 'internal gateway error' },
});
const HTTP_INTERNAL_ERROR = 500;

export async function handler(event: unknown): Promise<HttpResponse> {
  try {
    const parsed = FunctionUrlEventSchema.parse(event);
    const headers = lowerCaseHeaders(parsed.headers);
    const res = await gateway.handleGatewayRequest({
      method: parsed.requestContext.http.method,
      path: parsed.rawPath,
      token: tokenFrom(headers),
      body: decodeBody(parsed.body, parsed.isBase64Encoded),
      headers,
    });
    return { statusCode: res.status, headers: { 'content-type': res.contentType }, body: res.body };
  } catch (err) {
    logger.error({ event: 'http.request.error', err });
    return {
      statusCode: HTTP_INTERNAL_ERROR,
      headers: { 'content-type': 'application/json' },
      body: INTERNAL_ERROR_BODY,
    };
  }
}
