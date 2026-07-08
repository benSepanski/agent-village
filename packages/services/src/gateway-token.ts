import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AgentId, RunId } from '@agent-village/shared';

/**
 * Per-run bearer tokens for the Anthropic metering gateway (ADR 0004).
 *
 * Format: `avgw1.<agentId>.<runId>.<secret-hex>`. The ids ride in plaintext so
 * the gateway can locate the Run record; only the SHA-256 of the random secret
 * part is persisted (`Run.gatewayTokenHash`) — the full token exists solely in
 * the sandbox task's environment and dies with the run.
 */

const TOKEN_PREFIX = 'avgw1';
const TOKEN_PARTS = 4;
const SECRET_BYTES = 32;

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface MintedRunToken {
  /** Full bearer token — inject into the sandbox env, never persist. */
  token: string;
  /** SHA-256 hex of the secret part — store on the Run record. */
  tokenHash: string;
}

export function mintRunToken(agentId: AgentId, runId: RunId): MintedRunToken {
  const secret = randomBytes(SECRET_BYTES).toString('hex');
  return {
    token: `${TOKEN_PREFIX}.${agentId}.${runId}.${secret}`,
    tokenHash: sha256Hex(secret),
  };
}

export interface ParsedRunToken {
  agentId: AgentId;
  runId: RunId;
  /** SHA-256 hex of the presented secret — compare against the stored hash. */
  secretHash: string;
}

/** Structural parse only; possession is proven against `Run.gatewayTokenHash`. */
export function parseRunToken(token: string): ParsedRunToken | null {
  const parts = token.split('.');
  if (parts.length !== TOKEN_PARTS || parts[0] !== TOKEN_PREFIX || !parts[3]) return null;
  const agentId = AgentId.safeParse(parts[1]);
  const runId = RunId.safeParse(parts[2]);
  if (!agentId.success || !runId.success) return null;
  return { agentId: agentId.data, runId: runId.data, secretHash: sha256Hex(parts[3]) };
}

/** Constant-time comparison of the presented secret's hash with the stored one. */
export function tokenHashMatches(secretHash: string, storedHash: string): boolean {
  const presented = Buffer.from(secretHash, 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}
