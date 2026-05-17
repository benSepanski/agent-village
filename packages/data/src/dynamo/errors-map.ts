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
