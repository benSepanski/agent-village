import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoMock, type DynamoMock } from '../../test-utils/dynamodb-mock.js';
import { resetDocumentClient } from './client.js';
import { ensureProfile, getProfile } from './users.js';

let mock: DynamoMock;

const TEST_TABLE = 'agent-village-test';
const SUB = 'cog-sub-abc';

beforeEach(() => {
  process.env['AV_TABLE_NAME'] = TEST_TABLE;
  resetDocumentClient();
  mock = createDynamoMock();
  mock.reset();
});

afterEach(() => {
  mock.restore();
  delete process.env['AV_TABLE_NAME'];
});

describe('getProfile', () => {
  it('returns the profile when present', async () => {
    mock.on(GetCommand).resolves({
      Item: {
        cognitoSub: SUB,
        email: 'ben@example.com',
        displayName: 'Ben',
        createdAt: '2026-05-16T12:00:00.000Z',
      },
    });
    const profile = await getProfile(SUB);
    expect(profile?.email).toBe('ben@example.com');
  });

  it('returns null when the item is absent', async () => {
    mock.on(GetCommand).resolves({});
    expect(await getProfile(SUB)).toBeNull();
  });
});

describe('ensureProfile', () => {
  it('returns the existing profile without writing', async () => {
    mock.on(GetCommand).resolves({
      Item: {
        cognitoSub: SUB,
        email: 'ben@example.com',
        displayName: 'Ben',
        createdAt: '2026-05-16T12:00:00.000Z',
      },
    });
    const profile = await ensureProfile({
      cognitoSub: SUB,
      email: 'ben@example.com',
      displayName: 'Ben',
    });
    expect(profile.email).toBe('ben@example.com');
    expect(mock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('creates a new profile when absent', async () => {
    mock.on(GetCommand).resolves({});
    mock.on(PutCommand).resolves({});
    const profile = await ensureProfile({
      cognitoSub: SUB,
      email: 'ben@example.com',
      displayName: 'Ben',
      now: '2026-05-16T12:00:00.000Z',
    });
    expect(profile.createdAt).toBe('2026-05-16T12:00:00.000Z');
    const calls = mock.commandCalls(PutCommand);
    expect(calls).toHaveLength(1);
    const input = calls[0]!.args[0].input;
    expect(input.TableName).toBe(TEST_TABLE);
    expect(input.Item?.['pk']).toBe(`USER#${SUB}`);
    expect(input.Item?.['sk']).toBe('PROFILE');
  });
});
