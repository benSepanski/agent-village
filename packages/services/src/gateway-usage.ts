import { z } from '@agent-village/shared';
import type { TokenUsage } from '@agent-village/domain';

/**
 * Extract token usage from an Anthropic Messages API response so the metering
 * gateway can reconcile reserved spend to actual (ADR 0004). Handles both a
 * plain JSON body and a buffered SSE stream (`stream: true` responses):
 * `message_start` carries `input_tokens`, the last `message_delta` carries the
 * cumulative `output_tokens`.
 */

const JsonUsageSchema = z.object({
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

const MessageStartSchema = z.object({
  type: z.literal('message_start'),
  message: z.object({ usage: z.object({ input_tokens: z.number().int().nonnegative() }) }),
});

const MessageDeltaSchema = z.object({
  type: z.literal('message_delta'),
  usage: z.object({ output_tokens: z.number().int().nonnegative() }),
});

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonUsage(body: string): TokenUsage | null {
  const parsed = JsonUsageSchema.safeParse(safeJson(body));
  if (!parsed.success) return null;
  return {
    inputTokens: parsed.data.usage.input_tokens,
    outputTokens: parsed.data.usage.output_tokens,
  };
}

const SSE_DATA_PREFIX = 'data:';

function extractSseUsage(body: string): TokenUsage | null {
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  for (const line of body.split('\n')) {
    if (!line.startsWith(SSE_DATA_PREFIX)) continue;
    const event = safeJson(line.slice(SSE_DATA_PREFIX.length).trim());
    const start = MessageStartSchema.safeParse(event);
    if (start.success) inputTokens = start.data.message.usage.input_tokens;
    const delta = MessageDeltaSchema.safeParse(event);
    if (delta.success) outputTokens = delta.data.usage.output_tokens;
  }
  if (inputTokens === null || outputTokens === null) return null;
  return { inputTokens, outputTokens };
}

/** Returns null when no usage can be recovered (caller keeps the reservation). */
export function extractUsage(contentType: string, body: string): TokenUsage | null {
  return contentType.includes('text/event-stream') ? extractSseUsage(body) : extractJsonUsage(body);
}
