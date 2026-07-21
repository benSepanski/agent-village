import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

/**
 * AWS SDK throws ConditionalCheckFailedException when a Put/Update/Delete
 * ConditionExpression fails. The DocumentClient unmarshals the optional
 * Item (returned when ReturnValuesOnConditionCheckFailure is set on the
 * request) into a plain object.
 */
export interface ConditionalCheckFailed {
  name: 'ConditionalCheckFailedException';
  Item?: Record<string, unknown>;
}

export function isConditionalCheckFailed(err: unknown): err is ConditionalCheckFailed {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: unknown }).name === 'ConditionalCheckFailedException'
  );
}

/**
 * One item's outcome within a cancelled TransactWriteCommand. `Code` is
 * `'ConditionalCheckFailed'` for the item(s) whose ConditionExpression
 * failed; other items in the same transaction report `'None'`.
 *
 * NOTE: unlike single-item Put/Update/Delete, `DynamoDBDocumentClient` does
 * NOT unmarshal `CancellationReasons[].Item` — that translation middleware
 * only runs on the success path, and a thrown `TransactionCanceledException`
 * never reaches it (a known AWS SDK v3 gap). `Item` here is therefore still
 * in raw DynamoDB AttributeValue wire format; use `unmarshallCancellationItem`
 * to get plain JS values out of it.
 */
export interface CancellationReason {
  Code?: string;
  Item?: Record<string, AttributeValue>;
}

export interface TransactionCanceled {
  name: 'TransactionCanceledException';
  CancellationReasons?: CancellationReason[];
}

export function isTransactionCanceled(err: unknown): err is TransactionCanceled {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: unknown }).name === 'TransactionCanceledException'
  );
}

/** Unmarshal one CancellationReason's raw AttributeValue `Item` (see note above). */
export function unmarshallCancellationItem(
  reason: CancellationReason | undefined,
): Record<string, unknown> {
  if (!reason?.Item) return {};
  return unmarshall(reason.Item);
}
