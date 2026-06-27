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

// Fargate ARM64 (us-east-1) public-list pricing. Update if AWS adjusts prices.
const FARGATE_VCPU_PER_HOUR = 0.04048;
const FARGATE_GB_PER_HOUR = 0.004445;
const CPU_UNITS_PER_VCPU = 1024;
const MIB_PER_GB = 1024;
const MINUTES_PER_HOUR = 60;

/**
 * Worst-case compute cost of a single sandbox run: the task billed at full
 * `cpu`/`memMb` for its entire `timeoutMinutes`. Used to reserve spend before
 * launching, so a runaway schedule can't exceed an agent's spend limit. Actual
 * per-second Fargate cost reconciliation is a future refinement.
 */
export function estimateSandboxCost(timeoutMinutes: number, cpu: number, memMb: number): number {
  const vcpus = cpu / CPU_UNITS_PER_VCPU;
  const gib = memMb / MIB_PER_GB;
  const perHour = vcpus * FARGATE_VCPU_PER_HOUR + gib * FARGATE_GB_PER_HOUR;
  return (perHour * timeoutMinutes) / MINUTES_PER_HOUR;
}
