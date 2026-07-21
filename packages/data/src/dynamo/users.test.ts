import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { UserNotFoundError } from '@agent-village/domain';
import { createDynamoMock, type DynamoMock } from '../../test-utils/dynamodb-mock.js';
import { resetDocumentClient } from './client.js';
import { ensureProfile, getProfile, listAllProfiles, updateProfile } from './users.js';

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

const profileItem = {
  cognitoSub: SUB,
  email: 'ben@example.com',
  displayName: 'Ben',
  createdAt: '2026-05-16T12:00:00.000Z',
};

describe('updateProfile', () => {
  it('SETs userMonthlyBudgetUsd when given a number', async () => {
    mock.on(UpdateCommand).resolves({ Attributes: { ...profileItem, userMonthlyBudgetUsd: 50 } });
    const updated = await updateProfile({ cognitoSub: SUB, userMonthlyBudgetUsd: 50 });
    expect(updated.userMonthlyBudgetUsd).toBe(50);
    const call = mock.commandCalls(UpdateCommand)[0]!;
    expect(call.args[0].input.UpdateExpression).toBe('SET userMonthlyBudgetUsd = :budget');
    expect(call.args[0].input.ExpressionAttributeValues?.[':budget']).toBe(50);
  });

  it('REMOVEs userMonthlyBudgetUsd when given null (clears the cap)', async () => {
    mock.on(UpdateCommand).resolves({ Attributes: profileItem });
    const updated = await updateProfile({ cognitoSub: SUB, userMonthlyBudgetUsd: null });
    expect(updated.userMonthlyBudgetUsd).toBeUndefined();
    const call = mock.commandCalls(UpdateCommand)[0]!;
    expect(call.args[0].input.UpdateExpression).toBe('REMOVE userMonthlyBudgetUsd');
    expect(call.args[0].input.ExpressionAttributeValues).toBeUndefined();
  });

  it('throws UserNotFoundError when the profile does not exist', async () => {
    mock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('missing'), { name: 'ConditionalCheckFailedException' }));
    await expect(
      updateProfile({ cognitoSub: SUB, userMonthlyBudgetUsd: 50 }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });
});

describe('listAllProfiles', () => {
  it('scans for PROFILE items and parses each page', async () => {
    mock.on(ScanCommand).resolves({ Items: [profileItem] });
    const profiles = await listAllProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0]?.cognitoSub).toBe(SUB);
    const call = mock.commandCalls(ScanCommand)[0]!;
    expect(call.args[0].input.ExpressionAttributeValues?.[':sk']).toBe('PROFILE');
  });

  it('paginates across LastEvaluatedKey', async () => {
    mock
      .on(ScanCommand)
      .resolvesOnce({ Items: [profileItem], LastEvaluatedKey: { pk: 'x', sk: 'y' } })
      .resolvesOnce({ Items: [profileItem] });
    const profiles = await listAllProfiles();
    expect(profiles).toHaveLength(2);
  });
});
