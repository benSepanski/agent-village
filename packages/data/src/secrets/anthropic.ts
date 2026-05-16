import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { getSecretsClient } from './client.js';

export function secretName(agentId: string, env: string): string {
  return `agent-village/${env}/agents/${agentId}/anthropic-key`;
}

export interface StoredKey {
  arn: string;
}

/**
 * Create or overwrite the per-agent Anthropic secret. Returns the stable ARN
 * that the Agent record should reference. If the secret already exists at the
 * derived name (rare — happens when an agent is re-created with the same id),
 * the existing secret is updated via PutSecretValue and its ARN reused.
 */
export async function storeAnthropicKey(
  agentId: string,
  plaintextKey: string,
  env: string,
): Promise<StoredKey> {
  const Name = secretName(agentId, env);
  const client = getSecretsClient();
  try {
    const res = await client.send(new CreateSecretCommand({ Name, SecretString: plaintextKey }));
    if (!res.ARN) throw new Error('CreateSecret returned no ARN');
    return { arn: res.ARN };
  } catch (err) {
    if (err instanceof Error && err.name === 'ResourceExistsException') {
      const res = await client.send(
        new PutSecretValueCommand({ SecretId: Name, SecretString: plaintextKey }),
      );
      if (!res.ARN) throw new Error('PutSecretValue returned no ARN');
      return { arn: res.ARN };
    }
    throw err;
  }
}

export async function getAnthropicKey(arn: string): Promise<string> {
  const res = await getSecretsClient().send(new GetSecretValueCommand({ SecretId: arn }));
  if (!res.SecretString) throw new Error(`secret has no string value: ${arn}`);
  return res.SecretString;
}

export async function rotateAnthropicKey(arn: string, plaintextKey: string): Promise<void> {
  await getSecretsClient().send(
    new PutSecretValueCommand({ SecretId: arn, SecretString: plaintextKey }),
  );
}

export async function deleteAnthropicKey(arn: string): Promise<void> {
  await getSecretsClient().send(
    new DeleteSecretCommand({ SecretId: arn, ForceDeleteWithoutRecovery: true }),
  );
}
