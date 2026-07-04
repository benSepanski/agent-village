import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gatewayMock } = vi.hoisted(() => ({
  gatewayMock: { handleGatewayRequest: vi.fn() },
}));

vi.mock('@agent-village/services', () => ({ gateway: gatewayMock }));

import { handler } from './gateway.js';

const okResponse = { status: 200, contentType: 'application/json', body: '{"id":"msg_x"}' };

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rawPath: '/v1/messages',
    headers: { 'X-Api-Key': 'avgw1.a.b.c', 'Anthropic-Version': '2023-06-01' },
    requestContext: { http: { method: 'POST' } },
    body: '{"model":"claude-sonnet-4-6","max_tokens":10}',
    isBase64Encoded: false,
    ...overrides,
  };
}

beforeEach(() => {
  gatewayMock.handleGatewayRequest.mockReset().mockResolvedValue(okResponse);
});

describe('gateway Lambda handler', () => {
  it('maps the function-URL event to a gateway request (lower-cased headers, x-api-key token)', async () => {
    const res = await handler(event());
    expect(res).toEqual({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"id":"msg_x"}',
    });
    expect(gatewayMock.handleGatewayRequest).toHaveBeenCalledWith({
      method: 'POST',
      path: '/v1/messages',
      token: 'avgw1.a.b.c',
      body: '{"model":"claude-sonnet-4-6","max_tokens":10}',
      headers: expect.objectContaining({ 'anthropic-version': '2023-06-01' }),
    });
  });

  it('accepts an Authorization: Bearer token when x-api-key is absent', async () => {
    await handler(event({ headers: { authorization: 'Bearer avgw1.x.y.z' } }));
    expect(gatewayMock.handleGatewayRequest.mock.calls[0]![0].token).toBe('avgw1.x.y.z');
  });

  it('passes token null when no credential header is present', async () => {
    await handler(event({ headers: {} }));
    expect(gatewayMock.handleGatewayRequest.mock.calls[0]![0].token).toBeNull();
  });

  it('decodes a base64-encoded body', async () => {
    const raw = '{"model":"claude-sonnet-4-6","max_tokens":1}';
    await handler(event({ body: Buffer.from(raw).toString('base64'), isBase64Encoded: true }));
    expect(gatewayMock.handleGatewayRequest.mock.calls[0]![0].body).toBe(raw);
  });

  it('defaults a missing body to the empty string', async () => {
    await handler(event({ body: undefined }));
    expect(gatewayMock.handleGatewayRequest.mock.calls[0]![0].body).toBe('');
  });

  it('returns a 500 Anthropic-shaped error when the service throws', async () => {
    gatewayMock.handleGatewayRequest.mockRejectedValue(new Error('boom'));
    const res = await handler(event());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toMatchObject({ type: 'error', error: { type: 'api_error' } });
  });

  it('returns a 500 for a malformed event envelope', async () => {
    const res = await handler({ nope: true });
    expect(res.statusCode).toBe(500);
    expect(gatewayMock.handleGatewayRequest).not.toHaveBeenCalled();
  });
});
