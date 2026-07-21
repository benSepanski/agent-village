import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { createDynamoMock, type DynamoMock } from '../../test-utils/dynamodb-mock.js';
import { resetDocumentClient } from './client.js';
import { sumAgentLifetimeCost, sumUserMonthCost } from './spend-summaries.js';

const SUB = 'cog-sub-abc';
const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const TEST_TABLE = 'agent-village-test';

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

describe('sumUserMonthCost', () => {
  const now = new Date('2026-07-16T12:00:00.000Z');

  it('sums settled costUsd across the month and queries via GSI1', async () => {
    mock.on(QueryCommand).resolves({
      Items: [
        { costUsd: 1.5, reservedUsd: null, budgetWindowKey: null },
        { costUsd: 0.5, reservedUsd: null, budgetWindowKey: null },
      ],
    });
    const summary = await sumUserMonthCost(SUB, now);
    expect(summary.costUsd).toBeCloseTo(2);
    expect(summary.runCount).toBe(2);
    expect(summary.inFlightReservedUsd).toBe(0);
    const call = mock.commandCalls(QueryCommand)[0]!;
    expect(call.args[0].input.IndexName).toBe('gsi1');
    expect(call.args[0].input.ExpressionAttributeValues?.[':pk']).toBe(`USER#${SUB}`);
    expect(call.args[0].input.ExpressionAttributeValues?.[':month']).toBe('RUN#2026-07-');
  });

  it('counts inFlightReservedUsd only for runs reserved against THIS window', async () => {
    mock.on(QueryCommand).resolves({
      Items: [
        // In flight, reserved against July — counts.
        { costUsd: 0, reservedUsd: 3, budgetWindowKey: 'BUDGET#2026-07' },
        // In flight, but reserved against a DIFFERENT window (shouldn't happen
        // for a run created this month, but guards the equality check) — excluded.
        { costUsd: 0, reservedUsd: 7, budgetWindowKey: 'BUDGET#2026-06' },
        // Settled, no longer in flight — excluded from inFlightReservedUsd.
        { costUsd: 2, reservedUsd: null, budgetWindowKey: 'BUDGET#2026-07' },
      ],
    });
    const summary = await sumUserMonthCost(SUB, now);
    expect(summary.inFlightReservedUsd).toBe(3);
    expect(summary.costUsd).toBe(2);
    expect(summary.runCount).toBe(3);
  });

  it('paginates across LastEvaluatedKey', async () => {
    mock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ costUsd: 1 }], LastEvaluatedKey: { pk: 'x', sk: 'y' } })
      .resolvesOnce({ Items: [{ costUsd: 1 }] });
    const summary = await sumUserMonthCost(SUB, now);
    expect(summary.costUsd).toBe(2);
    expect(summary.runCount).toBe(2);
  });

  it('returns zeros when there are no runs', async () => {
    mock.on(QueryCommand).resolves({});
    expect(await sumUserMonthCost(SUB, now)).toEqual({
      costUsd: 0,
      inFlightReservedUsd: 0,
      runCount: 0,
    });
  });
});

describe('sumAgentLifetimeCost', () => {
  it('sums costUsd and in-flight reservedUsd across the whole agent partition', async () => {
    mock.on(QueryCommand).resolves({
      Items: [
        { costUsd: 1, reservedUsd: null },
        { costUsd: 0, reservedUsd: 0.25 },
      ],
    });
    const summary = await sumAgentLifetimeCost(AGENT_ID);
    expect(summary.costUsd).toBe(1);
    expect(summary.inFlightReservedUsd).toBe(0.25);
    const call = mock.commandCalls(QueryCommand)[0]!;
    expect(call.args[0].input.ExpressionAttributeValues?.[':pk']).toBe(`AGENT#${AGENT_ID}`);
  });

  it('paginates across LastEvaluatedKey', async () => {
    mock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ costUsd: 1 }], LastEvaluatedKey: { pk: 'x', sk: 'y' } })
      .resolvesOnce({ Items: [{ costUsd: 2 }] });
    const summary = await sumAgentLifetimeCost(AGENT_ID);
    expect(summary.costUsd).toBe(3);
  });

  it('returns zeros when there are no runs', async () => {
    mock.on(QueryCommand).resolves({});
    expect(await sumAgentLifetimeCost(AGENT_ID)).toEqual({ costUsd: 0, inFlightReservedUsd: 0 });
  });
});
