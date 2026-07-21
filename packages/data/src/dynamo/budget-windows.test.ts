import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoMock, type DynamoMock } from '../../test-utils/dynamodb-mock.js';
import { resetDocumentClient } from './client.js';
import { getWindow, listWindows } from './budget-windows.js';

const SUB = 'cog-sub-abc';
const TEST_TABLE = 'agent-village-test';

const windowItem = {
  ownerSub: SUB,
  month: '2026-07',
  spentUsd: 12.5,
  budgetLimitUsd: 50,
  updatedAt: '2026-07-16T12:00:00.000Z',
};

let mock: DynamoMock;

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

describe('getWindow', () => {
  it("gets the BUDGET# item for now's UTC month", async () => {
    mock.on(GetCommand).resolves({ Item: windowItem });
    const window = await getWindow(SUB, new Date('2026-07-16T12:00:00.000Z'));
    expect(window?.spentUsd).toBe(12.5);
    const call = mock.commandCalls(GetCommand)[0]!;
    expect(call.args[0].input.Key).toEqual({ pk: `USER#${SUB}`, sk: 'BUDGET#2026-07' });
  });

  it('returns null when the window has never been reserved into', async () => {
    mock.on(GetCommand).resolves({});
    expect(await getWindow(SUB, new Date('2026-07-16T12:00:00.000Z'))).toBeNull();
  });
});

describe('listWindows', () => {
  it('queries all BUDGET# items for the owner', async () => {
    mock.on(QueryCommand).resolves({ Items: [windowItem] });
    const windows = await listWindows(SUB);
    expect(windows).toHaveLength(1);
    const call = mock.commandCalls(QueryCommand)[0]!;
    expect(call.args[0].input.ExpressionAttributeValues?.[':pk']).toBe(`USER#${SUB}`);
    expect(call.args[0].input.ExpressionAttributeValues?.[':skPrefix']).toBe('BUDGET#');
  });

  it('paginates across LastEvaluatedKey', async () => {
    mock
      .on(QueryCommand)
      .resolvesOnce({ Items: [windowItem], LastEvaluatedKey: { pk: 'x', sk: 'y' } })
      .resolvesOnce({ Items: [{ ...windowItem, month: '2026-08' }] });
    const windows = await listWindows(SUB);
    expect(windows).toHaveLength(2);
  });

  it('returns an empty array when there are no windows', async () => {
    mock.on(QueryCommand).resolves({});
    expect(await listWindows(SUB)).toEqual([]);
  });
});
