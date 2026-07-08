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
  agentSecretName,
  deleteAgentSecret,
  deleteGithubPat,
  deleteNotionToken,
  getAgentSecret,
  getGithubPat,
  getNotionToken,
  githubSecretName,
  notionSecretName,
  storeAgentSecret,
  storeGithubPat,
  storeNotionToken,
} from './grants.js';

const ARN =
  'arn:aws:secretsmanager:us-east-1:000000000000:secret:agent-village/dev/agents/agent-1/notion-token-AbCdEf';
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

describe('grant secret names', () => {
  it('derives per-agent notion + github names under the agent prefix', () => {
    expect(notionSecretName(AGENT_ID, ENV)).toBe('agent-village/dev/agents/agent-1/notion-token');
    expect(githubSecretName(AGENT_ID, ENV)).toBe('agent-village/dev/agents/agent-1/github-pat');
  });

  it('derives generic named secrets under the same agent prefix', () => {
    expect(agentSecretName(AGENT_ID, 'gmail-app-password', ENV)).toBe(
      'agent-village/dev/agents/agent-1/gmail-app-password',
    );
  });
});

describe('storeNotionToken', () => {
  it('creates a new secret and returns its ARN', async () => {
    mock.on(CreateSecretCommand).resolves({ ARN });
    const { arn } = await storeNotionToken(AGENT_ID, 'ntn-secret', ENV);
    expect(arn).toBe(ARN);
    const call = mock.commandCalls(CreateSecretCommand)[0]!;
    expect(call.args[0].input.Name).toBe(notionSecretName(AGENT_ID, ENV));
    expect(call.args[0].input.SecretString).toBe('ntn-secret');
  });

  it('falls back to PutSecretValue when the secret already exists', async () => {
    mock
      .on(CreateSecretCommand)
      .rejects(Object.assign(new Error('exists'), { name: 'ResourceExistsException' }));
    mock.on(PutSecretValueCommand).resolves({ ARN });
    const { arn } = await storeNotionToken(AGENT_ID, 'ntn-secret', ENV);
    expect(arn).toBe(ARN);
    expect(mock.commandCalls(PutSecretValueCommand)).toHaveLength(1);
  });
});

describe('storeGithubPat', () => {
  it('creates the github-pat secret under the github name', async () => {
    mock.on(CreateSecretCommand).resolves({ ARN });
    await storeGithubPat(AGENT_ID, 'ghp_secret', ENV);
    const call = mock.commandCalls(CreateSecretCommand)[0]!;
    expect(call.args[0].input.Name).toBe(githubSecretName(AGENT_ID, ENV));
    expect(call.args[0].input.SecretString).toBe('ghp_secret');
  });
});

describe('generic agent secrets', () => {
  it('stores the secret under the derived per-agent name', async () => {
    mock.on(CreateSecretCommand).resolves({ ARN });
    const { arn } = await storeAgentSecret(AGENT_ID, 'gmail-app-password', 's3cret', ENV);
    expect(arn).toBe(ARN);
    const call = mock.commandCalls(CreateSecretCommand)[0]!;
    expect(call.args[0].input.Name).toBe('agent-village/dev/agents/agent-1/gmail-app-password');
    expect(call.args[0].input.SecretString).toBe('s3cret');
  });

  it('returns the secret string', async () => {
    mock.on(GetSecretValueCommand).resolves({ SecretString: 's3cret' });
    expect(await getAgentSecret(ARN)).toBe('s3cret');
  });

  it('force-deletes without recovery', async () => {
    mock.on(DeleteSecretCommand).resolves({});
    await deleteAgentSecret(ARN);
    const call = mock.commandCalls(DeleteSecretCommand)[0]!;
    expect(call.args[0].input.ForceDeleteWithoutRecovery).toBe(true);
  });
});

describe('get grant secrets', () => {
  it('returns the notion token string', async () => {
    mock.on(GetSecretValueCommand).resolves({ SecretString: 'ntn-zzz' });
    expect(await getNotionToken(ARN)).toBe('ntn-zzz');
  });

  it('returns the github pat string', async () => {
    mock.on(GetSecretValueCommand).resolves({ SecretString: 'ghp_zzz' });
    expect(await getGithubPat(ARN)).toBe('ghp_zzz');
  });

  it('throws when the secret has no string value', async () => {
    mock.on(GetSecretValueCommand).resolves({});
    await expect(getNotionToken(ARN)).rejects.toThrow(/no string value/);
  });
});

describe('delete grant secrets', () => {
  it('force-deletes the notion secret without recovery', async () => {
    mock.on(DeleteSecretCommand).resolves({});
    await deleteNotionToken(ARN);
    const call = mock.commandCalls(DeleteSecretCommand)[0]!;
    expect(call.args[0].input.ForceDeleteWithoutRecovery).toBe(true);
  });

  it('force-deletes the github secret without recovery', async () => {
    mock.on(DeleteSecretCommand).resolves({});
    await deleteGithubPat(ARN);
    const call = mock.commandCalls(DeleteSecretCommand)[0]!;
    expect(call.args[0].input.ForceDeleteWithoutRecovery).toBe(true);
  });
});
