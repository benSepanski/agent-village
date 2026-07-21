import { describe, expect, it } from 'vitest';
import {
  isConditionalCheckFailed,
  isTransactionCanceled,
  unmarshallCancellationItem,
} from './errors-map.js';

describe('isConditionalCheckFailed', () => {
  it('recognizes a ConditionalCheckFailedException', () => {
    const err = Object.assign(new Error('cap'), { name: 'ConditionalCheckFailedException' });
    expect(isConditionalCheckFailed(err)).toBe(true);
  });

  it('rejects other errors', () => {
    expect(isConditionalCheckFailed(new Error('boom'))).toBe(false);
    expect(isConditionalCheckFailed(null)).toBe(false);
    expect(isConditionalCheckFailed('nope')).toBe(false);
  });
});

describe('isTransactionCanceled', () => {
  it('recognizes a TransactionCanceledException', () => {
    const err = Object.assign(new Error('cancelled'), {
      name: 'TransactionCanceledException',
      CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
    });
    expect(isTransactionCanceled(err)).toBe(true);
  });

  it('rejects other errors, including a plain ConditionalCheckFailedException', () => {
    const err = Object.assign(new Error('cap'), { name: 'ConditionalCheckFailedException' });
    expect(isTransactionCanceled(err)).toBe(false);
    expect(isTransactionCanceled(null)).toBe(false);
  });
});

describe('unmarshallCancellationItem', () => {
  it('returns {} when the reason has no Item', () => {
    expect(unmarshallCancellationItem(undefined)).toEqual({});
    expect(unmarshallCancellationItem({ Code: 'None' })).toEqual({});
  });

  it('unmarshals a raw DynamoDB AttributeValue Item into plain JS values', () => {
    // DynamoDBDocumentClient does NOT unmarshal CancellationReasons[].Item (see
    // the note on CancellationReason) — this is the raw wire format it hands back.
    const reason = {
      Code: 'ConditionalCheckFailed',
      Item: { spendLimitUsd: { N: '1' }, spendUsedUsd: { N: '0.97' }, agentId: { S: 'agent-1' } },
    };
    expect(unmarshallCancellationItem(reason)).toEqual({
      spendLimitUsd: 1,
      spendUsedUsd: 0.97,
      agentId: 'agent-1',
    });
  });
});
