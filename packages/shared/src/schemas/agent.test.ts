import { describe, expect, it } from 'vitest';
import {
  AgentSchema,
  AgentStatus,
  AnthropicModel,
  CreateAgentInput,
  UpdateAgentInput,
} from './agent.js';
import { MAX_BUDGET_USD } from './spend-limits.js';

const validAgent = {
  id: '01HZ1234567890ABCDEFGHJKMN',
  ownerSub: 'cog-sub-abc-123',
  name: 'Daily summary',
  model: 'claude-opus-4-7',
  systemPrompt: 'You are a helpful assistant.',
  schedule: '*/5 * * * *',
  spendLimitUsd: 1,
  spendUsedUsd: 0,
  anthropicSecretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:foo',
  status: 'active',
  createdAt: '2026-05-16T12:00:00.000Z',
  updatedAt: '2026-05-16T12:00:00.000Z',
};

describe('AnthropicModel', () => {
  it('accepts known models', () => {
    expect(AnthropicModel.parse('claude-opus-4-7')).toBe('claude-opus-4-7');
    expect(AnthropicModel.parse('claude-sonnet-4-6')).toBe('claude-sonnet-4-6');
  });

  it('rejects unknown models', () => {
    expect(() => AnthropicModel.parse('gpt-4')).toThrow();
  });
});

describe('AgentStatus', () => {
  it('accepts active and paused', () => {
    expect(AgentStatus.parse('active')).toBe('active');
    expect(AgentStatus.parse('paused')).toBe('paused');
  });

  it('rejects other statuses', () => {
    expect(() => AgentStatus.parse('deleted')).toThrow();
  });
});

describe('AgentSchema', () => {
  it('roundtrips a valid agent', () => {
    const parsed = AgentSchema.parse(validAgent);
    expect(parsed.id).toBe(validAgent.id);
    expect(parsed.spendLimitUsd).toBe(1);
  });

  it('accepts a null schedule (manual-only)', () => {
    const parsed = AgentSchema.parse({ ...validAgent, schedule: null });
    expect(parsed.schedule).toBeNull();
  });

  it('rejects negative or zero spend limits', () => {
    expect(() => AgentSchema.parse({ ...validAgent, spendLimitUsd: 0 })).toThrow();
    expect(() => AgentSchema.parse({ ...validAgent, spendLimitUsd: -1 })).toThrow();
  });

  // Finding C (1.0-verdict.md punch-list #3): `.positive()` alone accepts
  // Infinity and NaN, and has no upper bound.
  it('rejects Infinity, -Infinity, and NaN spend limits', () => {
    expect(() => AgentSchema.parse({ ...validAgent, spendLimitUsd: Infinity })).toThrow();
    expect(() => AgentSchema.parse({ ...validAgent, spendLimitUsd: -Infinity })).toThrow();
    expect(() => AgentSchema.parse({ ...validAgent, spendLimitUsd: NaN })).toThrow();
  });

  it('rejects a spend limit above the cap but accepts one at the cap', () => {
    expect(() =>
      AgentSchema.parse({ ...validAgent, spendLimitUsd: MAX_BUDGET_USD + 0.01 }),
    ).toThrow();
    const parsed = AgentSchema.parse({ ...validAgent, spendLimitUsd: MAX_BUDGET_USD });
    expect(parsed.spendLimitUsd).toBe(MAX_BUDGET_USD);
  });

  it('round-trips a valid spend limit through JSON without loss', () => {
    const parsed = AgentSchema.parse(validAgent);
    const roundTripped = AgentSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(roundTripped.spendLimitUsd).toBe(validAgent.spendLimitUsd);
  });

  it('rejects names longer than 80 chars', () => {
    expect(() => AgentSchema.parse({ ...validAgent, name: 'a'.repeat(81) })).toThrow();
  });

  it('defaults the launcher-managed sandboxTaskDef cache to null', () => {
    expect(AgentSchema.parse(validAgent).sandboxTaskDef).toBeNull();
  });

  it('roundtrips a populated sandboxTaskDef cache', () => {
    const cache = {
      image: 'apply-bot',
      baseArn: 'arn:aws:ecs:us-east-1:0:task-definition/agent-village-dev-sandbox:1',
      arn: 'arn:aws:ecs:us-east-1:0:task-definition/agent-village-dev-sandbox:2',
    };
    expect(AgentSchema.parse({ ...validAgent, sandboxTaskDef: cache }).sandboxTaskDef).toEqual(
      cache,
    );
  });
});

describe('CreateAgentInput', () => {
  const validCreate = {
    name: 'My agent',
    model: 'claude-opus-4-7',
    systemPrompt: 'You are helpful.',
    schedule: '*/5 * * * *',
    spendLimitUsd: 1,
    anthropicApiKey: 'sk-ant-secret',
  };

  it('roundtrips a valid create input', () => {
    expect(CreateAgentInput.parse(validCreate)).toEqual(validCreate);
  });

  it('requires the plaintext anthropicApiKey', () => {
    const { anthropicApiKey: _unused, ...rest } = validCreate;
    expect(() => CreateAgentInput.parse(rest)).toThrow();
  });

  it('rejects Infinity, -Infinity, NaN, and zero/negative spend limits', () => {
    expect(() => CreateAgentInput.parse({ ...validCreate, spendLimitUsd: Infinity })).toThrow();
    expect(() => CreateAgentInput.parse({ ...validCreate, spendLimitUsd: -Infinity })).toThrow();
    expect(() => CreateAgentInput.parse({ ...validCreate, spendLimitUsd: NaN })).toThrow();
    expect(() => CreateAgentInput.parse({ ...validCreate, spendLimitUsd: 0 })).toThrow();
    expect(() => CreateAgentInput.parse({ ...validCreate, spendLimitUsd: -1 })).toThrow();
  });

  it('rejects a spend limit above the cap but accepts one at the cap', () => {
    expect(() =>
      CreateAgentInput.parse({ ...validCreate, spendLimitUsd: MAX_BUDGET_USD + 0.01 }),
    ).toThrow();
    expect(
      CreateAgentInput.parse({ ...validCreate, spendLimitUsd: MAX_BUDGET_USD }).spendLimitUsd,
    ).toBe(MAX_BUDGET_USD);
  });
});

describe('UpdateAgentInput', () => {
  const validManifest = {
    name: 'summarizer',
    image: 'summarizer',
    schedule: null,
    egressAllow: ['api.notion.com'],
    grants: [],
  };

  it('accepts a partial update', () => {
    expect(UpdateAgentInput.parse({ name: 'New name' })).toEqual({ name: 'New name' });
  });

  it('accepts an empty patch', () => {
    expect(UpdateAgentInput.parse({})).toEqual({});
  });

  it('rejects an unknown model in a patch', () => {
    expect(() => UpdateAgentInput.parse({ model: 'gpt-4' })).toThrow();
  });

  it('accepts a manifest to attach', () => {
    const parsed = UpdateAgentInput.parse({ manifest: validManifest });
    expect(parsed.manifest?.name).toBe('summarizer');
    expect(parsed.manifest?.image).toBe(validManifest.image);
  });

  it('accepts a null manifest to detach', () => {
    expect(UpdateAgentInput.parse({ manifest: null })).toEqual({ manifest: null });
  });

  it('rejects a malformed manifest', () => {
    expect(() => UpdateAgentInput.parse({ manifest: { ...validManifest, image: '' } })).toThrow();
  });

  it('rejects Infinity, -Infinity, and NaN in a spend-limit patch', () => {
    expect(() => UpdateAgentInput.parse({ spendLimitUsd: Infinity })).toThrow();
    expect(() => UpdateAgentInput.parse({ spendLimitUsd: -Infinity })).toThrow();
    expect(() => UpdateAgentInput.parse({ spendLimitUsd: NaN })).toThrow();
  });

  it('rejects a spend-limit patch above the cap but accepts one at the cap', () => {
    expect(() => UpdateAgentInput.parse({ spendLimitUsd: MAX_BUDGET_USD + 1 })).toThrow();
    expect(UpdateAgentInput.parse({ spendLimitUsd: MAX_BUDGET_USD })).toEqual({
      spendLimitUsd: MAX_BUDGET_USD,
    });
  });

  it('strips the internal sandboxTaskDef cache from a user patch', () => {
    // The cache is launcher-managed; a user patch must never be able to point
    // the agent at an arbitrary task definition.
    const parsed = UpdateAgentInput.parse({
      name: 'New name',
      sandboxTaskDef: { image: 'x', baseArn: 'y', arn: 'z' },
    });
    expect(parsed).toEqual({ name: 'New name' });
  });
});

describe('CreateAgentInput with manifest', () => {
  const validCreate = {
    name: 'My agent',
    model: 'claude-opus-4-7',
    systemPrompt: 'You are helpful.',
    schedule: '*/5 * * * *',
    spendLimitUsd: 1,
    anthropicApiKey: 'sk-ant-secret',
  };
  const validManifest = {
    name: 'summarizer',
    image: 'summarizer',
    schedule: null,
    egressAllow: ['api.notion.com'],
    grants: [],
  };

  it('accepts an optional manifest', () => {
    const parsed = CreateAgentInput.parse({ ...validCreate, manifest: validManifest });
    expect(parsed.manifest?.name).toBe('summarizer');
  });

  it('accepts a null manifest', () => {
    const parsed = CreateAgentInput.parse({ ...validCreate, manifest: null });
    expect(parsed.manifest).toBeNull();
  });

  it('rejects a malformed manifest', () => {
    expect(() =>
      CreateAgentInput.parse({ ...validCreate, manifest: { ...validManifest, image: '' } }),
    ).toThrow();
  });
});
