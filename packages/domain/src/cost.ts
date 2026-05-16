import type { AnthropicModel } from '@agent-village/shared';

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMtok: number;
  /** USD per 1M output tokens. */
  outputPerMtok: number;
}

// Public-list pricing approximations. Update when a new model is supported or
// Anthropic adjusts prices.
const PRICING: Record<AnthropicModel, ModelPricing> = {
  'claude-opus-4-7': { inputPerMtok: 15, outputPerMtok: 75 },
  'claude-sonnet-4-6': { inputPerMtok: 3, outputPerMtok: 15 },
  'claude-haiku-4-5-20251001': { inputPerMtok: 0.8, outputPerMtok: 4 },
};

const ONE_MILLION = 1_000_000;

/**
 * Worst-case cost for a single call. Used to reserve spend before the call.
 * Assumes the model emits exactly `maxOutputTokens` and uses negligible input
 * (the system prompt is small relative to output for our MVP agents).
 */
export function estimateCost(model: AnthropicModel, maxOutputTokens: number): number {
  const price = PRICING[model];
  return (maxOutputTokens * price.outputPerMtok) / ONE_MILLION;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Actual cost of a completed call given usage from the Anthropic response. */
export function actualCost(model: AnthropicModel, usage: TokenUsage): number {
  const price = PRICING[model];
  return (
    (usage.inputTokens * price.inputPerMtok + usage.outputTokens * price.outputPerMtok) /
    ONE_MILLION
  );
}

export function pricingFor(model: AnthropicModel): ModelPricing {
  return PRICING[model];
}
