import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface DataConfig {
  tableName: string;
  region: string;
}

export function getConfig(): DataConfig {
  const tableName = process.env['AV_TABLE_NAME'];
  if (!tableName || tableName.length === 0) {
    throw new Error('AV_TABLE_NAME environment variable is required');
  }
  return { tableName, region: process.env['AWS_REGION'] ?? 'us-east-1' };
}

let cached: DynamoDBDocumentClient | undefined;

function buildClient(): DynamoDBDocumentClient {
  const region = process.env['AWS_REGION'] ?? 'us-east-1';
  const local = process.env['AV_LOCAL'] === '1';
  const endpoint = local
    ? (process.env['AV_DYNAMO_ENDPOINT'] ?? 'http://localhost:8000')
    : undefined;
  const base = new DynamoDBClient({
    region,
    ...(endpoint
      ? { endpoint, credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
      : {}),
  });
  return DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export function getDocumentClient(): DynamoDBDocumentClient {
  cached ??= buildClient();
  return cached;
}

/** Test-only: drop the cached singleton so a fresh mock can be installed. */
export function resetDocumentClient(): void {
  cached = undefined;
}
