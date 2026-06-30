import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { RunNotFoundError } from '@agent-village/domain';
import { createDynamoMock, type DynamoMock } from '../../test-utils/dynamodb-mock.js';
import { resetDocumentClient } from './client.js';
import { append, getOne, listForAgent, patchRun } from './runs.js';

const SUB = 'cog-sub-abc';
const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const RUN_ID = '01HZN0PQRSTVWXYZ0123456789';
const TEST_TABLE = 'agent-village-test';

const runItem = {
  id: RUN_ID,
  agentId: AGENT_ID,
  ownerSub: SUB,
  status: 'ok',
  costUsd: 0.0042,
  tokensIn: 120,
  tokensOut: 85,
  output: 'Hello',
  error: null,
  durationMs: 1234,
  traceId: 'Root=1-abc',
  model: 'claude-opus-4-7',
  systemPromptHash: 'sha256:abc',
  dryRun: false,
  createdAt: '2026-05-16T12:00:00.000Z',
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

describe('append', () => {
  it('puts the marshaled run with conditional uniqueness', async () => {
    mock.on(PutCommand).resolves({});
    await append(runItem);
    const call = mock.commandCalls(PutCommand)[0]!;
    expect(call.args[0].input.Item?.['pk']).toBe(`AGENT#${AGENT_ID}`);
    expect(call.args[0].input.Item?.['sk']).toBe(`RUN#${runItem.createdAt}#${RUN_ID}`);
    expect(call.args[0].input.Item?.['gsi1pk']).toBe(`USER#${SUB}`);
    expect(call.args[0].input.ConditionExpression).toContain('attribute_not_exists');
  });
});

describe('listForAgent', () => {
  it('queries latest first with a default limit of 50', async () => {
    mock.on(QueryCommand).resolves({ Items: [runItem] });
    const runs = await listForAgent(AGENT_ID);
    expect(runs).toHaveLength(1);
    const call = mock.commandCalls(QueryCommand)[0]!;
    expect(call.args[0].input.Limit).toBe(50);
    expect(call.args[0].input.ScanIndexForward).toBe(false);
  });

  it('honors a custom limit', async () => {
    mock.on(QueryCommand).resolves({ Items: [] });
    await listForAgent(AGENT_ID, { limit: 5 });
    expect(mock.commandCalls(QueryCommand)[0]!.args[0].input.Limit).toBe(5);
  });
});

describe('getOne', () => {
  it('returns the run whose id matches', async () => {
    const other = { ...runItem, id: '01HZAAAAAAAAAAAAAAAAAAAAAA' };
    mock.on(QueryCommand).resolves({ Items: [other, runItem] });
    const run = await getOne(AGENT_ID, RUN_ID);
    expect(run?.id).toBe(RUN_ID);
  });

  it('returns null when no item matches the runId', async () => {
    mock.on(QueryCommand).resolves({ Items: [] });
    expect(await getOne(AGENT_ID, RUN_ID)).toBeNull();
  });

  it('paginates past the first page to find a later match', async () => {
    const other = { ...runItem, id: '01HZAAAAAAAAAAAAAAAAAAAAAA' };
    mock
      .on(QueryCommand)
      .resolvesOnce({ Items: [other], LastEvaluatedKey: { pk: 'x', sk: 'y' } })
      .resolvesOnce({ Items: [runItem] });
    const run = await getOne(AGENT_ID, RUN_ID);
    expect(run?.id).toBe(RUN_ID);
    expect(mock.commandCalls(QueryCommand)).toHaveLength(2);
    expect(mock.commandCalls(QueryCommand)[1]!.args[0].input.ExclusiveStartKey).toEqual({
      pk: 'x',
      sk: 'y',
    });
  });

  it('returns null after exhausting all pages', async () => {
    mock
      .on(QueryCommand)
      .resolvesOnce({ Items: [], LastEvaluatedKey: { pk: 'x', sk: 'y' } })
      .resolvesOnce({ Items: [] });
    expect(await getOne(AGENT_ID, RUN_ID)).toBeNull();
    expect(mock.commandCalls(QueryCommand)).toHaveLength(2);
  });
});

describe('patchRun', () => {
  it('updates the run keyed on its createdAt-prefixed sort key and re-parses ALL_NEW', async () => {
    const updated = { ...runItem, status: 'ok', exitCode: 0, durationMs: 5000 };
    mock.on(UpdateCommand).resolves({ Attributes: updated });
    const run = await patchRun(AGENT_ID, runItem.createdAt, RUN_ID, {
      status: 'ok',
      exitCode: 0,
      durationMs: 5000,
    });
    const call = mock.commandCalls(UpdateCommand)[0]!;
    expect(call.args[0].input.Key).toEqual({
      pk: `AGENT#${AGENT_ID}`,
      sk: `RUN#${runItem.createdAt}#${RUN_ID}`,
    });
    expect(call.args[0].input.UpdateExpression).toContain('#status = :status');
    expect(call.args[0].input.ConditionExpression).toContain('attribute_exists');
    expect(run.status).toBe('ok');
    expect(run.exitCode).toBe(0);
  });

  it('throws RunNotFoundError when the run no longer exists', async () => {
    mock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('gone'), { name: 'ConditionalCheckFailedException' }));
    await expect(
      patchRun(AGENT_ID, runItem.createdAt, RUN_ID, { status: 'error' }),
    ).rejects.toBeInstanceOf(RunNotFoundError);
  });
});
