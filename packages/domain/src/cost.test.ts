import { describe, expect, it } from 'vitest';
import {
  actualCost,
  actualSandboxCost,
  estimateCost,
  estimateGatewayCall,
  estimateSandboxCost,
  pricingFor,
} from './cost.js';

describe('estimateCost', () => {
  it('uses output pricing for the given model and max-tokens cap', () => {
    // Opus output is $25/Mtok; 1000 tokens = $0.025
    expect(estimateCost('claude-opus-4-7', 1000)).toBeCloseTo(0.025, 6);
  });

  it('is cheaper for haiku than opus at the same cap', () => {
    expect(estimateCost('claude-haiku-4-5-20251001', 1000)).toBeLessThan(
      estimateCost('claude-opus-4-7', 1000),
    );
  });
});

describe('actualCost', () => {
  it('sums input + output cost', () => {
    // Sonnet: $3/Mtok in + $15/Mtok out
    // 1000 in, 500 out -> 1000*3/1M + 500*15/1M = 0.003 + 0.0075 = 0.0105
    const cost = actualCost('claude-sonnet-4-6', { inputTokens: 1000, outputTokens: 500 });
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it('is zero for zero usage', () => {
    expect(actualCost('claude-opus-4-7', { inputTokens: 0, outputTokens: 0 })).toBe(0);
  });

  it('bills prompt-cache tokens at 1.25x (write) and 0.1x (read) the input rate', () => {
    // Sonnet: $3/Mtok in. 1M cache-write -> $3.75; 1M cache-read -> $0.30.
    const cost = actualCost('claude-sonnet-4-6', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
      cacheReadInputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3.75 + 0.3, 6);
  });

  it('bills the 1-hour-TTL portion of cache writes at 2x, not 1.25x', () => {
    // Sonnet $3/Mtok in. 1M total writes, of which 400k are 1h-TTL:
    // 600k @ 1.25x = $2.25; 400k @ 2.0x = $2.40; total $4.65.
    const cost = actualCost('claude-sonnet-4-6', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
      cacheCreation1hInputTokens: 400_000,
    });
    expect(cost).toBeCloseTo(2.25 + 2.4, 6);
  });

  it('treats all cache writes as 5-minute (1.25x) when no 1h breakdown is present', () => {
    const cost = actualCost('claude-sonnet-4-6', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3.75, 6);
  });
});

describe('estimateSandboxCost', () => {
  it('bills cpu + memory for the full timeout window', () => {
    // ARM64/Graviton rates: 0.25 vCPU + 0.5 GiB for 60 min:
    // 0.25*0.03238 + 0.5*0.003556 = 0.009873
    expect(estimateSandboxCost(60, 256, 512)).toBeCloseTo(0.009873, 6);
  });

  it('scales linearly with the timeout', () => {
    expect(estimateSandboxCost(120, 256, 512)).toBeCloseTo(
      2 * estimateSandboxCost(60, 256, 512),
      6,
    );
  });

  it('is more expensive for a larger task', () => {
    expect(estimateSandboxCost(30, 512, 1024)).toBeGreaterThan(estimateSandboxCost(30, 256, 512));
  });
});

describe('actualSandboxCost', () => {
  it('matches the flat estimate when the task ran its full window', () => {
    // 30 min = 1_800_000 ms
    expect(actualSandboxCost(1_800_000, 256, 512)).toBeCloseTo(
      estimateSandboxCost(30, 256, 512),
      9,
    );
  });

  it('bills a fraction of the estimate for an early exit', () => {
    // 3 min actual vs a 30 min reservation → one tenth of the flat cost.
    expect(actualSandboxCost(180_000, 256, 512)).toBeCloseTo(
      estimateSandboxCost(30, 256, 512) / 10,
      9,
    );
  });

  it("applies Fargate's one-minute minimum to instant exits", () => {
    const oneMinute = estimateSandboxCost(1, 256, 512);
    expect(actualSandboxCost(0, 256, 512)).toBeCloseTo(oneMinute, 9);
    expect(actualSandboxCost(1_000, 256, 512)).toBeCloseTo(oneMinute, 9);
  });

  it('can exceed the flat estimate when the task outlived its timeout', () => {
    expect(actualSandboxCost(3_600_000, 256, 512)).toBeGreaterThan(
      estimateSandboxCost(30, 256, 512),
    );
  });
});

describe('estimateGatewayCall', () => {
  it('prices max output tokens plus chars/4 approximated input tokens', () => {
    // Sonnet: 4000 chars -> 1000 input tokens @ $3/Mtok = 0.003;
    // 500 max output tokens @ $15/Mtok = 0.0075.
    expect(estimateGatewayCall('claude-sonnet-4-6', 500, 4000)).toBeCloseTo(0.0105, 6);
  });

  it('rounds partial input tokens up', () => {
    // 1 char still reserves one input token.
    const oneChar = estimateGatewayCall('claude-sonnet-4-6', 0, 1);
    expect(oneChar).toBeCloseTo(3 / 1_000_000, 12);
  });

  it('costs at least the pure-output estimate for the same cap', () => {
    expect(estimateGatewayCall('claude-opus-4-7', 1000, 4000)).toBeGreaterThan(
      estimateCost('claude-opus-4-7', 1000),
    );
  });
});

describe('pricingFor', () => {
  it('exposes input + output rates per supported model', () => {
    const opus = pricingFor('claude-opus-4-7');
    expect(opus.inputPerMtok).toBeGreaterThan(0);
    expect(opus.outputPerMtok).toBeGreaterThan(opus.inputPerMtok);
  });
});
