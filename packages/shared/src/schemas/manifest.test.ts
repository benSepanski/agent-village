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

  it('accepts a generic secret grant with a kebab-case name and UPPER_SNAKE env', () => {
    const grant = ToolGrant.parse({
      kind: 'secret',
      name: 'gmail-app-password',
      env: 'GMAIL_APP_PASSWORD',
    });
    expect(grant.kind).toBe('secret');
  });

  it('rejects secret grant names that are not kebab-case', () => {
    for (const name of [
      'Gmail-App-Password', // uppercase
      'gmail_app_password', // underscores
      '-gmail', // leading hyphen
      'gmail-', // trailing hyphen
      'a--b', // double hyphen
      'a/b', // path separator: would escape the agent's secret prefix
      'a.b', // dots
      '', // empty
    ]) {
      expect(() => ToolGrant.parse({ kind: 'secret', name, env: 'X' }), name).toThrow();
    }
  });

  it('rejects secret grant names that are platform-managed leaves', () => {
    // 'anthropic-key' would hand the sandbox the real Anthropic key, bypassing
    // the metering gateway's spend cap (ADR 0004).
    for (const name of ['anthropic-key', 'notion-token', 'github-pat']) {
      expect(() => ToolGrant.parse({ kind: 'secret', name, env: 'X' }), name).toThrow();
    }
  });

  it('rejects secret grant env vars that are not valid env var names', () => {
    for (const env of ['gmail_app_password', '1PASSWORD', 'MY VAR', 'MY-VAR', '']) {
      expect(() => ToolGrant.parse({ kind: 'secret', name: 'ok', env }), env).toThrow();
    }
  });

  it('rejects secret grant env vars that collide with platform-reserved env', () => {
    for (const env of [
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_API_KEY',
      'AV_WORKSPACE_URI',
      'AV_ANYTHING_FUTURE',
      'AWS_SECRET_ACCESS_KEY',
      'NOTION_TOKEN',
      'GITHUB_TOKEN',
      'HTTPS_PROXY',
      'PATH',
    ]) {
      expect(() => ToolGrant.parse({ kind: 'secret', name: 'ok', env }), env).toThrow();
    }
  });
});

describe('ApplicationManifest', () => {
  it('applies defaults for timeout, egress, grants, env, and flush interval', () => {
    const parsed = ApplicationManifest.parse(validManifest);
    expect(parsed.timeoutMinutes).toBe(30);
    expect(parsed.egressAllow).toEqual([]);
    expect(parsed.grants).toEqual([]);
    expect(parsed.env).toEqual({});
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

  it('accepts multiple secret grants with distinct env vars', () => {
    const parsed = ApplicationManifest.parse({
      ...validManifest,
      grants: [
        { kind: 'secret', name: 'gmail-app-password', env: 'GMAIL_APP_PASSWORD' },
        { kind: 'secret', name: 'slack-webhook', env: 'SLACK_WEBHOOK_URL' },
      ],
    });
    expect(parsed.grants).toHaveLength(2);
  });

  it('rejects two secret grants injecting the same env var', () => {
    expect(() =>
      ApplicationManifest.parse({
        ...validManifest,
        grants: [
          { kind: 'secret', name: 'password-a', env: 'APP_PASSWORD' },
          { kind: 'secret', name: 'password-b', env: 'APP_PASSWORD' },
        ],
      }),
    ).toThrow(/duplicate secret grant env var/);
  });

  it('accepts a plain env map with UPPER_SNAKE_CASE keys', () => {
    const parsed = ApplicationManifest.parse({
      ...validManifest,
      env: { GMAIL_ADDRESS: 'agent@example.com', GMAIL_MAX_REPLIES: '3' },
    });
    expect(parsed.env).toEqual({ GMAIL_ADDRESS: 'agent@example.com', GMAIL_MAX_REPLIES: '3' });
  });

  it('rejects env keys that are malformed or platform-reserved', () => {
    for (const key of [
      'gmail_address', // lowercase
      'MY-VAR', // hyphen
      'AV_WORKSPACE_URI', // platform contract prefix
      'ANTHROPIC_API_KEY', // metering gateway prefix
      'AWS_SECRET_ACCESS_KEY', // scoped STS creds prefix
      'NOTION_TOKEN', // typed-grant name
      'PATH', // entrypoint runtime var
      'HTTPS_PROXY', // deliberately unset (ADR 0003)
    ]) {
      expect(
        () => ApplicationManifest.parse({ ...validManifest, env: { [key]: 'v' } }),
        key,
      ).toThrow();
    }
  });

  it('rejects empty and oversized env values', () => {
    expect(() => ApplicationManifest.parse({ ...validManifest, env: { A: '' } })).toThrow();
    expect(() =>
      ApplicationManifest.parse({ ...validManifest, env: { A: 'x'.repeat(2049) } }),
    ).toThrow();
  });

  it('rejects an env map with more than 20 entries', () => {
    const env = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`VAR_${String(i)}`, 'v']));
    expect(() => ApplicationManifest.parse({ ...validManifest, env })).toThrow(/at most 20/);
  });

  it('rejects an env key that collides with a secret grant env var', () => {
    expect(() =>
      ApplicationManifest.parse({
        ...validManifest,
        env: { GMAIL_APP_PASSWORD: 'not-actually-secret' },
        grants: [{ kind: 'secret', name: 'gmail-app-password', env: 'GMAIL_APP_PASSWORD' }],
      }),
    ).toThrow(/collides with a secret grant env var/);
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
