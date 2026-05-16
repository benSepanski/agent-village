import { describe, expect, it } from 'vitest';
import { hashSystemPrompt } from './prompt.js';

describe('hashSystemPrompt', () => {
  it('produces a stable sha256-prefixed hex digest', () => {
    const hash = hashSystemPrompt('hello world');
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('returns the same hash for the same input', () => {
    expect(hashSystemPrompt('abc')).toBe(hashSystemPrompt('abc'));
  });

  it('returns different hashes for different inputs', () => {
    expect(hashSystemPrompt('abc')).not.toBe(hashSystemPrompt('abd'));
  });
});
