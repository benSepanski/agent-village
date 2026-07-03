import { describe, expect, it } from 'vitest';
import {
  AgentSchema,
  AgentStatus,
  AnthropicModel,
  CreateAgentInput,
  UpdateAgentInput,
} from './agent.js';

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

  it('rejects names longer than 80 chars', () => {
    expect(() => AgentSchema.parse({ ...validAgent, name: 'a'.repeat(81) })).toThrow();
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
});

describe('UpdateAgentInput', () => {
  const validManifest = {
    name: 'summarizer',
    image: '123.dkr.ecr.us-east-1.amazonaws.com/summarizer:latest',
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
    image: '123.dkr.ecr.us-east-1.amazonaws.com/summarizer:latest',
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
