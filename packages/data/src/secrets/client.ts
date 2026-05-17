import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

let cached: SecretsManagerClient | undefined;

function buildClient(): SecretsManagerClient {
  const region = process.env['AWS_REGION'] ?? 'us-east-1';
  const local = process.env['AV_LOCAL'] === '1';
  const endpoint = local
    ? (process.env['AV_SECRETS_ENDPOINT'] ?? 'http://localhost:4566')
    : undefined;
  return new SecretsManagerClient({
    region,
    ...(endpoint
      ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
      : {}),
  });
}

export function getSecretsClient(): SecretsManagerClient {
  cached ??= buildClient();
  return cached;
}

/** Test-only: drop the cached singleton. */
export function resetSecretsClient(): void {
  cached = undefined;
}
