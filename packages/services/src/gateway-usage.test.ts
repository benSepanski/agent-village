import { describe, expect, it } from 'vitest';
import { extractUsage } from './gateway-usage.js';

describe('extractUsage (JSON body)', () => {
  it('reads usage from a non-streaming messages response', () => {
    const body = JSON.stringify({
      id: 'msg_x',
      content: [{ type: 'text', text: 'hi' }],
      usage: { input_tokens: 120, output_tokens: 45 },
    });
    expect(extractUsage('application/json', body)).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      cacheCreationInputTokens: 0,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });

  it('carries prompt-cache tokens (billed at 1.25x / 0.1x the input rate)', () => {
    const body = JSON.stringify({
      id: 'msg_x',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 2048,
        cache_read_input_tokens: 4096,
      },
    });
    expect(extractUsage('application/json', body)).toEqual({
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationInputTokens: 2048,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 4096,
    });
  });

  it('separates the 1-hour-TTL cache-write bucket (priced at 2x) from the aggregate', () => {
    const body = JSON.stringify({
      id: 'msg_x',
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 1000,
        cache_creation: { ephemeral_5m_input_tokens: 600, ephemeral_1h_input_tokens: 400 },
      },
    });
    expect(extractUsage('application/json', body)).toMatchObject({
      cacheCreationInputTokens: 1000,
      cacheCreation1hInputTokens: 400,
    });
  });

  it('returns null for JSON without a usage block', () => {
    expect(extractUsage('application/json', JSON.stringify({ id: 'msg_x' }))).toBeNull();
  });

  it('returns null for non-JSON garbage', () => {
    expect(extractUsage('application/json', '<html>oops</html>')).toBeNull();
  });
});

const SSE_BODY = [
  'event: message_start',
  `data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 33, output_tokens: 1, cache_creation_input_tokens: 7, cache_read_input_tokens: 11 } } })}`,
  '',
  'event: content_block_delta',
  `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'hi' } })}`,
  '',
  'event: message_delta',
  `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 12 } })}`,
  '',
  'event: message_delta',
  `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 57 } })}`,
  '',
  'event: message_stop',
  `data: ${JSON.stringify({ type: 'message_stop' })}`,
  '',
].join('\n');

describe('extractUsage (buffered SSE stream)', () => {
  it('takes input (and cache tokens) from message_start and the LAST cumulative message_delta output', () => {
    expect(extractUsage('text/event-stream; charset=utf-8', SSE_BODY)).toEqual({
      inputTokens: 33,
      outputTokens: 57,
      cacheCreationInputTokens: 7,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 11,
    });
  });

  it('returns null when the stream never completed (no message_delta)', () => {
    const truncated = SSE_BODY.split('\n').slice(0, 5).join('\n');
    expect(extractUsage('text/event-stream', truncated)).toBeNull();
  });

  it('survives malformed data lines', () => {
    const noisy = `data: {not json}\n${SSE_BODY}`;
    expect(extractUsage('text/event-stream', noisy)).toEqual({
      inputTokens: 33,
      outputTokens: 57,
      cacheCreationInputTokens: 7,
      cacheCreation1hInputTokens: 0,
      cacheReadInputTokens: 11,
    });
  });
});
