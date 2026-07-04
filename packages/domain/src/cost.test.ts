import { describe, expect, it } from 'vitest';
import {
  actualCost,
  estimateCost,
  estimateGatewayCall,
  estimateSandboxCost,
  pricingFor,
} from './cost.js';

describe('estimateCost', () => {
  it('uses output pricing for the given model and max-tokens cap', () => {
    // Opus output is $75/Mtok; 1000 tokens = $0.075
    expect(estimateCost('claude-opus-4-7', 1000)).toBeCloseTo(0.075, 6);
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
});

describe('estimateSandboxCost', () => {
  it('bills cpu + memory for the full timeout window', () => {
    // 0.25 vCPU + 0.5 GiB for 60 min:
    // 0.25*0.04048 + 0.5*0.004445 = 0.0123425
    expect(estimateSandboxCost(60, 256, 512)).toBeCloseTo(0.0123425, 6);
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
