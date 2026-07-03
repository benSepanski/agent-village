import { describe, expect, it } from 'vitest';
import { GrantSecretOwnershipError } from './errors.js';
import { agentSecretPrefix, assertGrantSecretOwned } from './grants.js';

const AGENT_ID = 'agent-1';
const ENV = 'dev';

describe('agentSecretPrefix', () => {
  it('builds the per-agent secret prefix', () => {
    expect(agentSecretPrefix(AGENT_ID, ENV)).toBe('agent-village/dev/agents/agent-1/');
  });
});

describe('assertGrantSecretOwned', () => {
  it('accepts a bare secret name under the agent prefix', () => {
    expect(() =>
      assertGrantSecretOwned('agent-village/dev/agents/agent-1/notion-token', AGENT_ID, ENV),
    ).not.toThrow();
  });

  it('accepts a full ARN containing the agent prefix', () => {
    const arn =
      'arn:aws:secretsmanager:us-east-1:0:secret:agent-village/dev/agents/agent-1/github-pat-AbCdEf';
    expect(() => assertGrantSecretOwned(arn, AGENT_ID, ENV)).not.toThrow();
  });

  it('rejects a secret name owned by another agent', () => {
    expect(() =>
      assertGrantSecretOwned('agent-village/dev/agents/agent-2/notion-token', AGENT_ID, ENV),
    ).toThrow(GrantSecretOwnershipError);
  });

  it('rejects a secret name from another env', () => {
    expect(() =>
      assertGrantSecretOwned('agent-village/prod/agents/agent-1/notion-token', AGENT_ID, ENV),
    ).toThrow(GrantSecretOwnershipError);
  });

  it('rejects a victim secret that merely embeds the agent prefix as a substring', () => {
    // The anchored check must not be fooled by the prefix appearing later in the
    // string; the name segment must START with the agent's own prefix.
    expect(() =>
      assertGrantSecretOwned(
        'agent-village/dev/agents/victim/notion-token#agent-village/dev/agents/agent-1/',
        AGENT_ID,
        ENV,
      ),
    ).toThrow(GrantSecretOwnershipError);
  });

  it('rejects an ARN whose secret name segment belongs to another agent', () => {
    const arn =
      'arn:aws:secretsmanager:us-east-1:0:secret:agent-village/dev/agents/victim/notion-token-AbCdEf';
    expect(() => assertGrantSecretOwned(arn, AGENT_ID, ENV)).toThrow(GrantSecretOwnershipError);
  });

  it('carries a 400 status and the offending name', () => {
    try {
      assertGrantSecretOwned('other/secret', AGENT_ID, ENV);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(GrantSecretOwnershipError);
      const typed = err as GrantSecretOwnershipError;
      expect(typed.statusCode).toBe(400);
      expect(typed.details.agentId).toBe(AGENT_ID);
      expect(typed.details.secretName).toBe('other/secret');
    }
  });
});
