import { GrantSecretOwnershipError } from './errors.js';

/**
 * Secrets Manager name prefix that scopes every secret owned by one agent.
 * Grant secret names (Notion token / GitHub PAT) MUST live under this prefix so
 * a manifest cannot name another agent's secret. Canonical builder — mirror it
 * anywhere a per-agent secret name is derived.
 */
export function agentSecretPrefix(agentId: string, env: string): string {
  return `agent-village/${env}/agents/${agentId}/`;
}

/**
 * Guard the free-form `secretName` on a Notion/GitHub grant: a malicious
 * manifest could name ANOTHER agent's secret, so require the name to sit under
 * this agent's own prefix. Throws a 400 `GrantSecretOwnershipError` otherwise.
 * The name may be a bare Secrets Manager name or a full ARN — in both cases the
 * agent prefix must be ANCHORED at the start of the name segment, not merely
 * present somewhere in the string (a substring check would accept
 * `.../agents/VICTIM/token#.../agents/ME/`).
 */
export function assertGrantSecretOwned(secretName: string, agentId: string, env: string): void {
  const prefix = agentSecretPrefix(agentId, env);
  // A Secrets Manager ARN is `arn:...:secret:<name>`; compare the name segment.
  const marker = ':secret:';
  const idx = secretName.indexOf(marker);
  const name = idx === -1 ? secretName : secretName.slice(idx + marker.length);
  if (!name.startsWith(prefix)) {
    throw new GrantSecretOwnershipError(agentId, secretName);
  }
}
