import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SpendLimitExceededError, UserBudgetExceededError } from '@agent-village/domain';
import { createDynamoMock, type DynamoMock } from '../../test-utils/dynamodb-mock.js';
import { resetDocumentClient } from './client.js';
import { finalizeSpendWithUserBudget, reserveSpendWithUserBudget } from './spend-tx.js';

const SUB = 'cog-sub-abc';
const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const TEST_TABLE = 'agent-village-test';
const WINDOW_KEY = 'BUDGET#2026-07';

const userBudget = { windowKey: WINDOW_KEY, limitUsd: 50, now: '2026-07-16T12:00:00.000Z' };

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

describe('reserveSpendWithUserBudget', () => {
  it('issues a two-item transaction: agent leg then window leg', async () => {
    mock.on(TransactWriteCommand).resolves({});
    await reserveSpendWithUserBudget({
      agentId: AGENT_ID,
      ownerSub: SUB,
      estimateUsd: 0.05,
      userBudget,
    });
    const call = mock.commandCalls(TransactWriteCommand)[0]!;
    const items = call.args[0].input.TransactItems!;
    expect(items).toHaveLength(2);

    const agentLeg = items[0]!.Update!;
    expect(agentLeg.Key).toEqual({ pk: `USER#${SUB}`, sk: `AGENT#${AGENT_ID}` });
    expect(agentLeg.ConditionExpression).toBe('spendUsedUsd + :est <= spendLimitUsd');

    const windowLeg = items[1]!.Update!;
    expect(windowLeg.Key).toEqual({ pk: `USER#${SUB}`, sk: WINDOW_KEY });
    expect(windowLeg.ConditionExpression).toBe('if_not_exists(spentUsd, :zero) + :est <= :lim');
    expect(windowLeg.ExpressionAttributeValues?.[':month']).toBe('2026-07');
    expect(windowLeg.ExpressionAttributeValues?.[':lim']).toBe(50);
    expect(windowLeg.ExpressionAttributeValues?.[':own']).toBe(SUB);
  });

  it('derives :month from the pinned windowKey, not from `now` (cross-rollover reserve)', async () => {
    // A run started in July whose gateway call fires in August still reserves
    // into BUDGET#2026-07 (the run's pinned window), but `now` reflects the
    // August wall-clock time of the call. The :month label must track the
    // window key's own month, not `now`'s, or the July item's `month`
    // attribute drifts from its own sk (M3 verification MINOR 3).
    mock.on(TransactWriteCommand).resolves({});
    await reserveSpendWithUserBudget({
      agentId: AGENT_ID,
      ownerSub: SUB,
      estimateUsd: 0.05,
      userBudget: { windowKey: 'BUDGET#2026-07', limitUsd: 50, now: '2026-08-01T00:05:00.000Z' },
    });
    const call = mock.commandCalls(TransactWriteCommand)[0]!;
    const windowLeg = call.args[0].input.TransactItems![1]!.Update!;
    expect(windowLeg.Key).toEqual({ pk: `USER#${SUB}`, sk: 'BUDGET#2026-07' });
    expect(windowLeg.ExpressionAttributeValues?.[':month']).toBe('2026-07');
  });

  it('the window leg bootstraps a missing window via if_not_exists (lazy upsert)', async () => {
    mock.on(TransactWriteCommand).resolves({});
    await reserveSpendWithUserBudget({
      agentId: AGENT_ID,
      ownerSub: SUB,
      estimateUsd: 1,
      userBudget,
    });
    const call = mock.commandCalls(TransactWriteCommand)[0]!;
    const windowLeg = call.args[0].input.TransactItems![1]!.Update!;
    expect(windowLeg.ConditionExpression).toContain('if_not_exists(spentUsd, :zero)');
    expect(windowLeg.ExpressionAttributeValues?.[':zero']).toBe(0);
  });

  it('throws SpendLimitExceededError when the AGENT leg fails (index 0) — agent cap wins', async () => {
    const err = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [
        {
          Code: 'ConditionalCheckFailed',
          Item: { spendLimitUsd: { N: '1' }, spendUsedUsd: { N: '0.99' } },
        },
        { Code: 'ConditionalCheckFailed', Item: { spentUsd: { N: '49.99' } } },
      ],
    });
    mock.on(TransactWriteCommand).rejects(err);
    await expect(
      reserveSpendWithUserBudget({
        agentId: AGENT_ID,
        ownerSub: SUB,
        estimateUsd: 0.05,
        userBudget,
      }),
    ).rejects.toMatchObject({
      name: 'SpendLimitExceededError',
      details: { spendLimitUsd: 1, spendUsedUsd: 0.99, estimateUsd: 0.05 },
    });
    expect(SpendLimitExceededError).toBeDefined();
  });

  it('throws UserBudgetExceededError when only the WINDOW leg fails (index 1)', async () => {
    const err = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [
        { Code: 'None' },
        { Code: 'ConditionalCheckFailed', Item: { spentUsd: { N: '49.99' } } },
      ],
    });
    mock.on(TransactWriteCommand).rejects(err);
    await expect(
      reserveSpendWithUserBudget({
        agentId: AGENT_ID,
        ownerSub: SUB,
        estimateUsd: 0.05,
        userBudget,
      }),
    ).rejects.toMatchObject({
      name: 'UserBudgetExceededError',
      details: {
        ownerSub: SUB,
        windowKey: WINDOW_KEY,
        budgetLimitUsd: 50,
        spentUsd: 49.99,
        estimateUsd: 0.05,
      },
    });
    expect(UserBudgetExceededError).toBeDefined();
  });

  it('rethrows non-cancellation errors untouched', async () => {
    const boom = new Error('network blip');
    mock.on(TransactWriteCommand).rejects(boom);
    await expect(
      reserveSpendWithUserBudget({
        agentId: AGENT_ID,
        ownerSub: SUB,
        estimateUsd: 0.05,
        userBudget,
      }),
    ).rejects.toBe(boom);
  });

  it('rethrows the raw cancellation when neither reason is a condition failure', async () => {
    const err = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'None' }, { Code: 'None' }],
    });
    mock.on(TransactWriteCommand).rejects(err);
    await expect(
      reserveSpendWithUserBudget({
        agentId: AGENT_ID,
        ownerSub: SUB,
        estimateUsd: 0.05,
        userBudget,
      }),
    ).rejects.toBe(err);
  });
});

describe('finalizeSpendWithUserBudget', () => {
  it('issues an unconditional two-item ADD, both legs, no ConditionExpression', async () => {
    mock.on(TransactWriteCommand).resolves({});
    await finalizeSpendWithUserBudget({
      agentId: AGENT_ID,
      ownerSub: SUB,
      deltaUsd: -0.02,
      userWindowKey: WINDOW_KEY,
    });
    const call = mock.commandCalls(TransactWriteCommand)[0]!;
    const items = call.args[0].input.TransactItems!;
    expect(items).toHaveLength(2);

    const agentLeg = items[0]!.Update!;
    expect(agentLeg.Key).toEqual({ pk: `USER#${SUB}`, sk: `AGENT#${AGENT_ID}` });
    expect(agentLeg.ExpressionAttributeValues?.[':d']).toBe(-0.02);
    expect(agentLeg.ConditionExpression).toBeUndefined();

    const windowLeg = items[1]!.Update!;
    expect(windowLeg.Key).toEqual({ pk: `USER#${SUB}`, sk: WINDOW_KEY });
    expect(windowLeg.ExpressionAttributeValues?.[':d']).toBe(-0.02);
    expect(windowLeg.ConditionExpression).toBeUndefined();
  });

  it('settles against a PRIOR month window when passed an old windowKey (rollover)', async () => {
    // A run reserved in July that stops in August must still settle against
    // July's window — the caller (services/runner) is responsible for reading
    // run.budgetWindowKey rather than deriving from `new Date()`; this proves
    // the data layer honors whatever key it is handed, not "now".
    mock.on(TransactWriteCommand).resolves({});
    await finalizeSpendWithUserBudget({
      agentId: AGENT_ID,
      ownerSub: SUB,
      deltaUsd: 0.5,
      userWindowKey: 'BUDGET#2026-07',
    });
    const call = mock.commandCalls(TransactWriteCommand)[0]!;
    const windowLeg = call.args[0].input.TransactItems![1]!.Update!;
    expect(windowLeg.Key).toEqual({ pk: `USER#${SUB}`, sk: 'BUDGET#2026-07' });
  });
});
