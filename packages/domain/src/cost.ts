import type { AnthropicModel } from '@agent-village/shared';

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMtok: number;
  /** USD per 1M output tokens. */
  outputPerMtok: number;
}

// Public-list pricing (per docs.anthropic.com as of 2026-06). Update when a
// new model is supported or Anthropic adjusts prices; every id in
// ANTHROPIC_MODELS (shared agent schema) must have a row here or the metering
// gateway 400s it.
const PRICING: Record<AnthropicModel, ModelPricing> = {
  'claude-fable-5': { inputPerMtok: 10, outputPerMtok: 50 },
  'claude-opus-4-8': { inputPerMtok: 5, outputPerMtok: 25 },
  'claude-opus-4-7': { inputPerMtok: 5, outputPerMtok: 25 },
  'claude-sonnet-5': { inputPerMtok: 3, outputPerMtok: 15 },
  'claude-sonnet-4-6': { inputPerMtok: 3, outputPerMtok: 15 },
  'claude-haiku-4-5': { inputPerMtok: 1, outputPerMtok: 5 },
  'claude-haiku-4-5-20251001': { inputPerMtok: 1, outputPerMtok: 5 },
};

const ONE_MILLION = 1_000_000;

/**
 * Worst-case cost for a single call. Used to reserve spend before the call, so
 * it must UPPER-BOUND the actual cost or the hard spend cap can be breached:
 * the model emits at most `maxOutputTokens`, and input is priced from
 * `inputChars` (system prompt + user message). Omitting the input term let a
 * large system prompt — allowed up to 20k chars (~5k tokens) — settle above the
 * cap, since finalizeSpend applies the estimate→actual delta unconditionally.
 */
export function estimateCost(
  model: AnthropicModel,
  maxOutputTokens: number,
  inputChars = 0,
): number {
  const price = PRICING[model];
  const inputTokens = Math.ceil(inputChars / APPROX_CHARS_PER_TOKEN);
  return (inputTokens * price.inputPerMtok + maxOutputTokens * price.outputPerMtok) / ONE_MILLION;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** `cache_creation_input_tokens` (aggregate) — 5-minute writes billed 1.25x. */
  cacheCreationInputTokens?: number;
  /**
   * `cache_creation.ephemeral_1h_input_tokens` — the 1-hour-TTL portion of the
   * aggregate above, billed at 2x (not 1.25x). Anthropic returns the breakdown
   * only when 1h caching is used, so absent ⇒ all writes are 5-minute.
   */
  cacheCreation1hInputTokens?: number;
  /** `cache_read_input_tokens` — billed at 0.1x the input rate. */
  cacheReadInputTokens?: number;
}

// Anthropic prompt-caching multipliers on the input rate. Cache writes bill at
// 1.25x for the default 5-minute TTL and 2x for the 1-hour TTL.
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2;
const CACHE_READ_INPUT_MULTIPLIER = 0.1;

/** Actual cost of a completed call given usage from the Anthropic response. */
export function actualCost(model: AnthropicModel, usage: TokenUsage): number {
  const price = PRICING[model];
  const cacheWriteTotal = usage.cacheCreationInputTokens ?? 0;
  const cacheWrite1h = Math.min(usage.cacheCreation1hInputTokens ?? 0, cacheWriteTotal);
  const cacheWrite5m = cacheWriteTotal - cacheWrite1h;
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  return (
    (usage.inputTokens * price.inputPerMtok +
      cacheWrite5m * price.inputPerMtok * CACHE_WRITE_5M_MULTIPLIER +
      cacheWrite1h * price.inputPerMtok * CACHE_WRITE_1H_MULTIPLIER +
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
  // Reserve input at the 1h cache-WRITE ceiling (2x the input rate): any prompt
  // token may be billed as a cache-creation write, which actualCost prices at
  // up to 2x. Pricing the reservation's input at 1x under-reserved cache-heavy
  // calls (exactly the apply-bot pattern: large 1h-TTL cached prompts), letting
  // reconcile's positive delta settle above the hard cap. The gateway reconciles
  // to real usage right after the call, so the headroom holds for one call only.
  return (
    (inputTokens * price.inputPerMtok * CACHE_WRITE_1H_MULTIPLIER +
      maxOutputTokens * price.outputPerMtok) /
    ONE_MILLION
  );
}

// Fargate ARM64 / Graviton (us-east-1) public-list pricing — the task
// definition is CpuArchitecture.ARM64, which lists ~20% below x86
// ($0.04048 / $0.004445). Update if AWS adjusts prices.
const FARGATE_VCPU_PER_HOUR = 0.03238;
const FARGATE_GB_PER_HOUR = 0.003556;
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
