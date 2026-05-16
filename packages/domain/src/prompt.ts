import { createHash } from 'node:crypto';

/**
 * Stable hash of a system prompt. Used to verify that a Replay reused the
 * exact prompt the original run captured.
 */
export function hashSystemPrompt(prompt: string): string {
  return `sha256:${createHash('sha256').update(prompt).digest('hex')}`;
}
