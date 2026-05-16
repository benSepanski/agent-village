import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';

export function createDynamoMock() {
  return mockClient(DynamoDBDocumentClient);
}

export type DynamoMock = ReturnType<typeof createDynamoMock>;
