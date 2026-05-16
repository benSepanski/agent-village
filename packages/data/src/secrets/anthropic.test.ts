import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { createSecretsMock, type SecretsMock } from '../../test-utils/secrets-mock.js';
import { resetSecretsClient } from './client.js';
import {
  deleteAnthropicKey,
  getAnthropicKey,
  rotateAnthropicKey,
  secretName,
  storeAnthropicKey,
} from './anthropic.js';

const ARN =
  'arn:aws:secretsmanager:us-east-1:000000000000:secret:agent-village/dev/agents/agent-1/anthropic-key-AbCdEf';
const AGENT_ID = 'agent-1';
const ENV = 'dev';

let mock: SecretsMock;

beforeEach(() => {
  resetSecretsClient();
  mock = createSecretsMock();
  mock.reset();
});

afterEach(() => {
  mock.restore();
});

describe('secretName', () => {
  it('encodes env + agent id under the agent-village prefix', () => {
    expect(secretName(AGENT_ID, ENV)).toBe('agent-village/dev/agents/agent-1/anthropic-key');
  });
});

describe('storeAnthropicKey', () => {
  it('creates a new secret and returns its ARN', async () => {
    mock.on(CreateSecretCommand).resolves({ ARN });
    const { arn } = await storeAnthropicKey(AGENT_ID, 'sk-ant-secret', ENV);
    expect(arn).toBe(ARN);
    const call = mock.commandCalls(CreateSecretCommand)[0]!;
    expect(call.args[0].input.Name).toBe(secretName(AGENT_ID, ENV));
    expect(call.args[0].input.SecretString).toBe('sk-ant-secret');
  });

  it('falls back to PutSecretValue when the secret already exists', async () => {
    mock
      .on(CreateSecretCommand)
      .rejects(Object.assign(new Error('exists'), { name: 'ResourceExistsException' }));
    mock.on(PutSecretValueCommand).resolves({ ARN });
    const { arn } = await storeAnthropicKey(AGENT_ID, 'sk-ant-secret', ENV);
    expect(arn).toBe(ARN);
    expect(mock.commandCalls(PutSecretValueCommand)).toHaveLength(1);
  });

  it('roundtrips with getAnthropicKey', async () => {
    mock.on(CreateSecretCommand).resolves({ ARN });
    mock.on(GetSecretValueCommand).resolves({ SecretString: 'sk-ant-secret' });
    const { arn } = await storeAnthropicKey(AGENT_ID, 'sk-ant-secret', ENV);
    expect(await getAnthropicKey(arn)).toBe('sk-ant-secret');
  });
});

describe('getAnthropicKey', () => {
  it('returns the secret string', async () => {
    mock.on(GetSecretValueCommand).resolves({ SecretString: 'sk-ant-zzz' });
    expect(await getAnthropicKey(ARN)).toBe('sk-ant-zzz');
  });

  it('throws when the secret has no string value', async () => {
    mock.on(GetSecretValueCommand).resolves({});
    await expect(getAnthropicKey(ARN)).rejects.toThrow(/no string value/);
  });
});

describe('rotateAnthropicKey', () => {
  it('writes a new value to the same ARN', async () => {
    mock.on(PutSecretValueCommand).resolves({ ARN });
    await rotateAnthropicKey(ARN, 'sk-ant-new');
    const call = mock.commandCalls(PutSecretValueCommand)[0]!;
    expect(call.args[0].input.SecretId).toBe(ARN);
    expect(call.args[0].input.SecretString).toBe('sk-ant-new');
  });
});

describe('deleteAnthropicKey', () => {
  it('issues an immediate force delete', async () => {
    mock.on(DeleteSecretCommand).resolves({});
    await deleteAnthropicKey(ARN);
    const call = mock.commandCalls(DeleteSecretCommand)[0]!;
    expect(call.args[0].input.ForceDeleteWithoutRecovery).toBe(true);
  });
});
