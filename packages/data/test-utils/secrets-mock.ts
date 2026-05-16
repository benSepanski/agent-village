import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { mockClient } from 'aws-sdk-client-mock';

export function createSecretsMock() {
  return mockClient(SecretsManagerClient);
}

export type SecretsMock = ReturnType<typeof createSecretsMock>;
