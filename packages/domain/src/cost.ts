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
  /** `cache_creation_input_tokens` — billed at 1.25x the input rate. */
  cacheCreationInputTokens?: number;
  /** `cache_read_input_tokens` — billed at 0.1x the input rate. */
  cacheReadInputTokens?: number;
}

// Anthropic prompt-caching multipliers on the input rate.
const CACHE_WRITE_INPUT_MULTIPLIER = 1.25;
const CACHE_READ_INPUT_MULTIPLIER = 0.1;

/** Actual cost of a completed call given usage from the Anthropic response. */
export function actualCost(model: AnthropicModel, usage: TokenUsage): number {
  const price = PRICING[model];
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  return (
    (usage.inputTokens * price.inputPerMtok +
      cacheWrite * price.inputPerMtok * CACHE_WRITE_INPUT_MULTIPLIER +
      cacheRead * price.inputPerMtok * CACHE_READ_INPUT_MULTIPLIER +
      usage.outputTokens * price.outputPerMtok) /
    ONE_MILLION
  );
}

export function pricingFor(model: AnthropicModel): ModelPricing {
  return PRICING[model];
}

/** Rough request-size → input-token conversion for gateway reservations. */
const APPROX_CHARS_PER_TOKEN = 4;

/**
 * Pre-call reservation for a gateway-proxied Anthropic call (ADR 0004):
 * worst-case output (`max_tokens`) plus input approximated from the request
 * body size. The estimate holds the budget only for the duration of one call —
 * the gateway reconciles to the response's real `usage` immediately after, so
 * approximation error never persists in the ledger.
 */
export function estimateGatewayCall(
  model: AnthropicModel,
  maxOutputTokens: number,
  requestChars: number,
): number {
  const price = PRICING[model];
  const inputTokens = Math.ceil(requestChars / APPROX_CHARS_PER_TOKEN);
  return (inputTokens * price.inputPerMtok + maxOutputTokens * price.outputPerMtok) / ONE_MILLION;
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
 * launching, so a runaway schedule can't exceed an agent's spend limit. The
 * lifecycle handler reconciles the reservation to the task's actual duration
 * via `actualSandboxCost` when it stops.
 */
export function estimateSandboxCost(timeoutMinutes: number, cpu: number, memMb: number): number {
  const vcpus = cpu / CPU_UNITS_PER_VCPU;
  const gib = memMb / MIB_PER_GB;
  const perHour = vcpus * FARGATE_VCPU_PER_HOUR + gib * FARGATE_GB_PER_HOUR;
  return (perHour * timeoutMinutes) / MINUTES_PER_HOUR;
}

/** Fargate bills per second with a one-minute minimum per task. */
const FARGATE_MIN_BILLED_MS = 60_000;
const MS_PER_MINUTE = 60_000;

/**
 * Actual compute cost of a finished sandbox run, from the task's observed
 * start→stop duration. Applies Fargate's one-minute minimum, so a task that
 * exits (or fails) immediately still bills one minute — never zero.
 */
export function actualSandboxCost(durationMs: number, cpu: number, memMb: number): number {
  const billedMs = Math.max(durationMs, FARGATE_MIN_BILLED_MS);
  return estimateSandboxCost(billedMs / MS_PER_MINUTE, cpu, memMb);
}
