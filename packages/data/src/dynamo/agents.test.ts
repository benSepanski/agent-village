import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { AgentNotFoundError, SpendLimitExceededError } from '@agent-village/domain';
import { createDynamoMock, type DynamoMock } from '../../test-utils/dynamodb-mock.js';
import { resetDocumentClient } from './client.js';
import {
  createAgent,
  deleteAgent,
  finalizeSpend,
  getAgent,
  getAgentById,
  listMyAgents,
  reserveSpend,
  updateAgent,
} from './agents.js';

const SUB = 'cog-sub-abc';
const AGENT_ID = '01HZ1234567890ABCDEFGHJKMN';
const TEST_TABLE = 'agent-village-test';

const agentItem = {
  id: AGENT_ID,
  ownerSub: SUB,
  name: 'Daily summary',
  model: 'claude-opus-4-7',
  systemPrompt: 'You are helpful.',
  schedule: '*/5 * * * *',
  spendLimitUsd: 1,
  spendUsedUsd: 0,
  anthropicSecretArn: 'arn:aws:secretsmanager:us-east-1:000000000000:secret:foo',
  status: 'active',
  createdAt: '2026-05-16T12:00:00.000Z',
  updatedAt: '2026-05-16T12:00:00.000Z',
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

describe('listMyAgents', () => {
  it('queries by user partition and returns parsed agents', async () => {
    mock.on(QueryCommand).resolves({ Items: [agentItem] });
    const agents = await listMyAgents(SUB);
    expect(agents).toHaveLength(1);
    expect(agents[0]?.id).toBe(AGENT_ID);
    const call = mock.commandCalls(QueryCommand)[0]!;
    expect(call.args[0].input.ExpressionAttributeValues?.[':pk']).toBe(`USER#${SUB}`);
  });

  it('returns an empty array when there are no items', async () => {
    mock.on(QueryCommand).resolves({});
    expect(await listMyAgents(SUB)).toEqual([]);
  });
});

describe('getAgent', () => {
  it('returns the parsed agent', async () => {
    mock.on(GetCommand).resolves({ Item: agentItem });
    const agent = await getAgent(SUB, AGENT_ID);
    expect(agent?.id).toBe(AGENT_ID);
  });

  it('returns null when absent', async () => {
    mock.on(GetCommand).resolves({});
    expect(await getAgent(SUB, AGENT_ID)).toBeNull();
  });
});

describe('getAgentById', () => {
  it('queries via gsi1 and returns the agent', async () => {
    mock.on(QueryCommand).resolves({ Items: [agentItem] });
    const agent = await getAgentById(AGENT_ID);
    expect(agent?.ownerSub).toBe(SUB);
    const call = mock.commandCalls(QueryCommand)[0]!;
    expect(call.args[0].input.IndexName).toBe('gsi1');
  });

  it('returns null when the gsi query is empty', async () => {
    mock.on(QueryCommand).resolves({ Items: [] });
    expect(await getAgentById(AGENT_ID)).toBeNull();
  });
});

describe('createAgent', () => {
  it('puts the marshaled item with conditional uniqueness', async () => {
    mock.on(PutCommand).resolves({});
    await createAgent(agentItem);
    const call = mock.commandCalls(PutCommand)[0]!;
    expect(call.args[0].input.Item?.['pk']).toBe(`USER#${SUB}`);
    expect(call.args[0].input.Item?.['sk']).toBe(`AGENT#${AGENT_ID}`);
    expect(call.args[0].input.Item?.['gsi1pk']).toBe(`AGENT#${AGENT_ID}`);
    expect(call.args[0].input.ConditionExpression).toContain('attribute_not_exists');
  });
});

describe('updateAgent', () => {
  it('builds a SET expression for patched fields and parses the new attributes', async () => {
    mock.on(UpdateCommand).resolves({
      Attributes: { ...agentItem, name: 'Renamed', updatedAt: '2026-05-17T00:00:00.000Z' },
    });
    const updated = await updateAgent({
      agentId: AGENT_ID,
      ownerSub: SUB,
      patch: { name: 'Renamed' },
      now: '2026-05-17T00:00:00.000Z',
    });
    expect(updated.name).toBe('Renamed');
    const call = mock.commandCalls(UpdateCommand)[0]!;
    expect(call.args[0].input.UpdateExpression).toContain('#name = :name');
    expect(call.args[0].input.UpdateExpression).toContain('#updatedAt = :updatedAt');
  });

  it('throws AgentNotFoundError when the agent is missing', async () => {
    mock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error('not found'), { name: 'ConditionalCheckFailedException' }));
    await expect(
      updateAgent({ agentId: AGENT_ID, ownerSub: SUB, patch: { name: 'X' } }),
    ).rejects.toBeInstanceOf(AgentNotFoundError);
  });
});

describe('deleteAgent', () => {
  it('issues a conditional delete', async () => {
    mock.on(DeleteCommand).resolves({});
    await deleteAgent(SUB, AGENT_ID);
    const call = mock.commandCalls(DeleteCommand)[0]!;
    expect(call.args[0].input.ConditionExpression).toContain('attribute_exists');
  });

  it('throws AgentNotFoundError when the agent does not exist', async () => {
    mock
      .on(DeleteCommand)
      .rejects(Object.assign(new Error('not found'), { name: 'ConditionalCheckFailedException' }));
    await expect(deleteAgent(SUB, AGENT_ID)).rejects.toBeInstanceOf(AgentNotFoundError);
  });
});

describe('reserveSpend', () => {
  it('issues a conditional ADD against spendUsedUsd', async () => {
    mock.on(UpdateCommand).resolves({});
    await reserveSpend({ agentId: AGENT_ID, ownerSub: SUB, estimateUsd: 0.05 });
    const call = mock.commandCalls(UpdateCommand)[0]!;
    expect(call.args[0].input.ConditionExpression).toContain(
      'spendUsedUsd + :estimate <= spendLimitUsd',
    );
    expect(call.args[0].input.ExpressionAttributeValues?.[':estimate']).toBe(0.05);
  });

  it('throws SpendLimitExceededError with current values on condition failure', async () => {
    const condErr = Object.assign(new Error('cap'), {
      name: 'ConditionalCheckFailedException',
      Item: { spendLimitUsd: 1, spendUsedUsd: 0.97 },
    });
    mock.on(UpdateCommand).rejects(condErr);
    await expect(
      reserveSpend({ agentId: AGENT_ID, ownerSub: SUB, estimateUsd: 0.05 }),
    ).rejects.toMatchObject({
      name: 'SpendLimitExceededError',
      details: { spendLimitUsd: 1, spendUsedUsd: 0.97, estimateUsd: 0.05 },
    });
    expect(SpendLimitExceededError).toBeDefined();
  });
});

describe('finalizeSpend', () => {
  it('issues an unconditional ADD with the delta', async () => {
    mock.on(UpdateCommand).resolves({});
    await finalizeSpend({ agentId: AGENT_ID, ownerSub: SUB, deltaUsd: -0.02 });
    const call = mock.commandCalls(UpdateCommand)[0]!;
    expect(call.args[0].input.ExpressionAttributeValues?.[':delta']).toBe(-0.02);
    expect(call.args[0].input.ConditionExpression).toBeUndefined();
  });
});
