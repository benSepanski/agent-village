import { z } from '@agent-village/shared';
import type { TokenUsage } from '@agent-village/domain';

/**
 * Extract token usage from an Anthropic Messages API response so the metering
 * gateway can reconcile reserved spend to actual (ADR 0004). Handles both a
 * plain JSON body and a buffered SSE stream (`stream: true` responses):
 * `message_start` carries `input_tokens`, the last `message_delta` carries the
 * cumulative `output_tokens`.
 */

// Cache tokens are billed too (5-min write 1.25x, 1-hour write 2x, read 0.1x
// input rate) — ignoring them would under-count real Anthropic billing, the
// unsafe direction for a spend cap. `cache_creation` breaks the aggregate
// `cache_creation_input_tokens` into per-TTL buckets; it is present only when
// caching is used, and the 1h bucket is what actualCost prices at 2x.
const CacheTokensSchema = z.object({
  cache_creation_input_tokens: z.number().int().nonnegative().optional(),
  cache_read_input_tokens: z.number().int().nonnegative().optional(),
  cache_creation: z
    .object({ ephemeral_1h_input_tokens: z.number().int().nonnegative().optional() })
    .optional(),
});

const JsonUsageSchema = z.object({
  usage: CacheTokensSchema.extend({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
  }),
});

const MessageStartSchema = z.object({
  type: z.literal('message_start'),
  message: z.object({
    usage: CacheTokensSchema.extend({ input_tokens: z.number().int().nonnegative() }),
  }),
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
    cacheCreationInputTokens: parsed.data.usage.cache_creation_input_tokens ?? 0,
    cacheCreation1hInputTokens: parsed.data.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    cacheReadInputTokens: parsed.data.usage.cache_read_input_tokens ?? 0,
  };
}

const SSE_DATA_PREFIX = 'data:';

type StartUsage = z.infer<typeof MessageStartSchema>['message']['usage'];

function extractSseUsage(body: string): TokenUsage | null {
  let start: StartUsage | null = null;
  let outputTokens: number | null = null;
  for (const line of body.split('\n')) {
    if (!line.startsWith(SSE_DATA_PREFIX)) continue;
    const event = safeJson(line.slice(SSE_DATA_PREFIX.length).trim());
    const parsedStart = MessageStartSchema.safeParse(event);
    if (parsedStart.success) start = parsedStart.data.message.usage;
    const delta = MessageDeltaSchema.safeParse(event);
    if (delta.success) outputTokens = delta.data.usage.output_tokens;
  }
  if (start === null || outputTokens === null) return null;
  return {
    inputTokens: start.input_tokens,
    outputTokens,
    cacheCreationInputTokens: start.cache_creation_input_tokens ?? 0,
    cacheCreation1hInputTokens: start.cache_creation?.ephemeral_1h_input_tokens ?? 0,
    cacheReadInputTokens: start.cache_read_input_tokens ?? 0,
  };
}

/** Returns null when no usage can be recovered (caller keeps the reservation). */
export function extractUsage(contentType: string, body: string): TokenUsage | null {
  return contentType.includes('text/event-stream') ? extractSseUsage(body) : extractJsonUsage(body);
}
