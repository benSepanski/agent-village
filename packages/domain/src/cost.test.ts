import { describe, expect, it } from 'vitest';
import { actualCost, estimateCost, pricingFor } from './cost.js';

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

describe('pricingFor', () => {
  it('exposes input + output rates per supported model', () => {
    const opus = pricingFor('claude-opus-4-7');
    expect(opus.inputPerMtok).toBeGreaterThan(0);
    expect(opus.outputPerMtok).toBeGreaterThan(opus.inputPerMtok);
  });
});
