import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ZodError, createLogger } from '@agent-village/shared';

const logger: ReturnType<typeof createLogger> = createLogger({
  env: process.env['AV_ENV'] ?? 'dev',
  service: 'api',
});

const JSON_HEADERS = { 'content-type': 'application/json' };

export interface RequestContext {
  cognitoSub: string;
  email: string;
  name?: string;
  traceId: string;
}

export type ContextualHandler = (
  event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ctx: RequestContext,
) => Promise<APIGatewayProxyResultV2>;

function extractContext(event: APIGatewayProxyEventV2WithJWTAuthorizer): RequestContext {
  const claims = event.requestContext.authorizer.jwt.claims;
  const ctx: RequestContext = {
    cognitoSub: String(claims['sub'] ?? ''),
    email: String(claims['email'] ?? ''),
    traceId: event.headers?.['x-amzn-trace-id'] ?? '',
  };
  if (claims['name'] !== undefined) ctx.name = String(claims['name']);
  return ctx;
}

interface MaybeDomainError {
  statusCode: number;
  message: string;
  details?: unknown;
}

function isDomainError(err: unknown): err is MaybeDomainError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'statusCode' in err &&
    typeof (err as { statusCode: unknown }).statusCode === 'number'
  );
}

export function errorResponse(err: unknown): APIGatewayProxyResultV2 {
  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'invalid input', issues: err.issues }),
    };
  }
  // A malformed request body (JSON.parse before the Zod parse in a handler) is a
  // client input error, not a server fault — surface it as 400, consistent with
  // the ZodError path, rather than an opaque 500.
  if (err instanceof SyntaxError) {
    return {
      statusCode: 400,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: 'invalid input' }),
    };
  }
  if (isDomainError(err)) {
    return {
      statusCode: err.statusCode,
      headers: JSON_HEADERS,
      body: JSON.stringify({ error: err.message, details: err.details ?? null }),
    };
  }
  return {
    statusCode: 500,
    headers: JSON_HEADERS,
    body: JSON.stringify({ error: 'internal error' }),
  };
}

export function jsonResponse(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

export function withContext(handler: ContextualHandler) {
  return async (
    event: APIGatewayProxyEventV2WithJWTAuthorizer,
  ): Promise<APIGatewayProxyResultV2> => {
    const ctx = extractContext(event);
    logger.info({
      event: 'http.request.received',
      path: event.rawPath,
      method: event.requestContext.http.method,
      userId: ctx.cognitoSub,
      traceId: ctx.traceId,
    });
    try {
      const result = await handler(event, ctx);
      logger.info({
        event: 'http.request.handled',
        path: event.rawPath,
        userId: ctx.cognitoSub,
        traceId: ctx.traceId,
      });
      return result;
    } catch (err) {
      logger.error({
        event: 'http.request.error',
        path: event.rawPath,
        userId: ctx.cognitoSub,
        traceId: ctx.traceId,
        err,
      });
      return errorResponse(err);
    }
  };
}
