import { describe, expect, it } from 'vitest';
import { AgentId, UserId } from './ids.js';
import { ApplicationManifest, EgressDomain, ToolGrant, workspacePrefix } from './manifest.js';

const validManifest = {
  name: 'Notion digest',
  image: '000000000000.dkr.ecr.us-east-1.amazonaws.com/digest:v3',
  schedule: '0 7 * * ? *',
};

describe('EgressDomain', () => {
  it('accepts bare and wildcard domains', () => {
    expect(EgressDomain.parse('api.notion.com')).toBe('api.notion.com');
    expect(EgressDomain.parse('*.anthropic.com')).toBe('*.anthropic.com');
  });

  it('rejects URLs, paths, and bare hosts', () => {
    expect(() => EgressDomain.parse('https://api.notion.com')).toThrow();
    expect(() => EgressDomain.parse('api.notion.com/v1')).toThrow();
    expect(() => EgressDomain.parse('localhost')).toThrow();
  });
});

describe('ToolGrant', () => {
  it('accepts an ses grant with recipients', () => {
    const grant = ToolGrant.parse({
      kind: 'ses',
      fromAddress: 'agent@example.com',
      allowedRecipients: ['me@example.com'],
    });
    expect(grant.kind).toBe('ses');
  });

  it('rejects an ses grant with no recipients', () => {
    expect(() =>
      ToolGrant.parse({ kind: 'ses', fromAddress: 'agent@example.com', allowedRecipients: [] }),
    ).toThrow();
  });

  it('accepts a github grant scoped to repos', () => {
    const grant = ToolGrant.parse({
      kind: 'github',
      repos: ['benSepanski/agent-village'],
      secretName: 'agent-village/dev/agents/x/github-pat',
    });
    expect(grant.kind).toBe('github');
  });

  it('rejects a github grant with a malformed repo slug', () => {
    expect(() =>
      ToolGrant.parse({ kind: 'github', repos: ['not a repo'], secretName: 's' }),
    ).toThrow();
  });

  it('rejects unknown grant kinds', () => {
    expect(() => ToolGrant.parse({ kind: 'slack', channel: '#general' })).toThrow();
  });
});

describe('ApplicationManifest', () => {
  it('applies defaults for timeout, egress, grants, and flush interval', () => {
    const parsed = ApplicationManifest.parse(validManifest);
    expect(parsed.timeoutMinutes).toBe(30);
    expect(parsed.egressAllow).toEqual([]);
    expect(parsed.grants).toEqual([]);
    expect(parsed.flushIntervalSeconds).toBe(300);
  });

  it('accepts a null schedule (manual-only)', () => {
    expect(ApplicationManifest.parse({ ...validManifest, schedule: null }).schedule).toBeNull();
  });

  it('accepts a full manifest with grants and egress', () => {
    const parsed = ApplicationManifest.parse({
      ...validManifest,
      command: ['node', 'dist/main.js'],
      egressAllow: ['api.anthropic.com', 'api.notion.com'],
      grants: [{ kind: 'notion', secretName: 'agent-village/dev/agents/x/notion-token' }],
      flushIntervalSeconds: 0,
    });
    expect(parsed.egressAllow).toHaveLength(2);
    expect(parsed.flushIntervalSeconds).toBe(0);
  });

  it('rejects an empty command array and out-of-bounds timeouts', () => {
    expect(() => ApplicationManifest.parse({ ...validManifest, command: [] })).toThrow();
    expect(() => ApplicationManifest.parse({ ...validManifest, timeoutMinutes: 0 })).toThrow();
    expect(() => ApplicationManifest.parse({ ...validManifest, timeoutMinutes: 121 })).toThrow();
  });
});

describe('workspacePrefix', () => {
  const agentId = AgentId.parse('01HZ1234567890ABCDEFGHJKMN');

  it('joins owner and agent ids with a trailing slash', () => {
    const ownerSub = UserId.parse('cog-sub-abc-123');
    expect(workspacePrefix(ownerSub, agentId)).toBe('cog-sub-abc-123/01HZ1234567890ABCDEFGHJKMN/');
  });

  it('rejects owner ids that could escape the prefix', () => {
    const malicious = UserId.parse('other-user/01HZ1234567890ABCDEFGHJKMN');
    expect(() => workspacePrefix(malicious, agentId)).toThrow();
  });
});
