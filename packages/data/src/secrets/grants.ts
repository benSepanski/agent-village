import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { agentSecretPrefix } from '@agent-village/domain';
import { getSecretsClient } from './client.js';

export interface StoredGrantSecret {
  arn: string;
}

/** Secrets Manager name of the per-agent Notion integration token. */
export function notionSecretName(agentId: string, env: string): string {
  return `agent-village/${env}/agents/${agentId}/notion-token`;
}

/** Secrets Manager name of the per-agent fine-grained GitHub PAT. */
export function githubSecretName(agentId: string, env: string): string {
  return `agent-village/${env}/agents/${agentId}/github-pat`;
}

/**
 * Create or overwrite a per-agent grant secret at `name`, returning its stable
 * ARN. Mirrors `secrets/anthropic.ts`: if the secret already exists (re-created
 * agent id), fall back to PutSecretValue and reuse the existing ARN.
 */
async function storeGrantSecret(name: string, plaintext: string): Promise<StoredGrantSecret> {
  const client = getSecretsClient();
  try {
    const res = await client.send(new CreateSecretCommand({ Name: name, SecretString: plaintext }));
    if (!res.ARN) throw new Error('CreateSecret returned no ARN');
    return { arn: res.ARN };
  } catch (err) {
    if (err instanceof Error && err.name === 'ResourceExistsException') {
      const res = await client.send(
        new PutSecretValueCommand({ SecretId: name, SecretString: plaintext }),
      );
      if (!res.ARN) throw new Error('PutSecretValue returned no ARN');
      return { arn: res.ARN };
    }
    throw err;
  }
}

async function getGrantSecret(id: string): Promise<string> {
  const res = await getSecretsClient().send(new GetSecretValueCommand({ SecretId: id }));
  if (!res.SecretString) throw new Error(`secret has no string value: ${id}`);
  return res.SecretString;
}

async function deleteGrantSecret(id: string): Promise<void> {
  await getSecretsClient().send(
    new DeleteSecretCommand({ SecretId: id, ForceDeleteWithoutRecovery: true }),
  );
}

export function storeNotionToken(
  agentId: string,
  plaintextToken: string,
  env: string,
): Promise<StoredGrantSecret> {
  return storeGrantSecret(notionSecretName(agentId, env), plaintextToken);
}

/** Fetch a Notion token by its secret name or ARN. */
export function getNotionToken(idOrName: string): Promise<string> {
  return getGrantSecret(idOrName);
}

export function deleteNotionToken(idOrName: string): Promise<void> {
  return deleteGrantSecret(idOrName);
}

export function storeGithubPat(
  agentId: string,
  plaintextPat: string,
  env: string,
): Promise<StoredGrantSecret> {
  return storeGrantSecret(githubSecretName(agentId, env), plaintextPat);
}

/** Fetch a GitHub PAT by its secret name or ARN. */
export function getGithubPat(idOrName: string): Promise<string> {
  return getGrantSecret(idOrName);
}

export function deleteGithubPat(idOrName: string): Promise<void> {
  return deleteGrantSecret(idOrName);
}

/**
 * Secrets Manager name of a generic named per-agent secret (`secret` grant):
 * `agent-village/<env>/agents/<agentId>/<name>`. Derived from the canonical
 * agent prefix so `assertGrantSecretOwned` accepts it by construction.
 */
export function agentSecretName(agentId: string, name: string, env: string): string {
  return `${agentSecretPrefix(agentId, env)}${name}`;
}

/** Create or overwrite the generic named secret `name` for `agentId`. */
export function storeAgentSecret(
  agentId: string,
  name: string,
  plaintext: string,
  env: string,
): Promise<StoredGrantSecret> {
  return storeGrantSecret(agentSecretName(agentId, name, env), plaintext);
}

/** Fetch a generic named per-agent secret by its secret name or ARN. */
export function getAgentSecret(idOrName: string): Promise<string> {
  return getGrantSecret(idOrName);
}

export function deleteAgentSecret(idOrName: string): Promise<void> {
  return deleteGrantSecret(idOrName);
}
