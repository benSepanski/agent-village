import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { UserBudgetWindowSchema, type UserBudgetWindow, type UserId } from '@agent-village/shared';
import { getConfig, getDocumentClient } from './client.js';
import { USER_BUDGET_SK_PREFIX, userBudgetSk, userPk } from './keys.js';

/** The owner's BUDGET# window for `now`'s UTC month, or null if never reserved into. */
export async function getWindow(ownerSub: UserId, now: Date): Promise<UserBudgetWindow | null> {
  const { tableName } = getConfig();
  const res = await getDocumentClient().send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: userPk(ownerSub), sk: userBudgetSk(now) },
    }),
  );
  return res.Item ? UserBudgetWindowSchema.parse(res.Item) : null;
}

/** Every BUDGET# window the owner has ever accrued (all months), oldest sk first. */
export async function listWindows(ownerSub: UserId): Promise<UserBudgetWindow[]> {
  const { tableName } = getConfig();
  const client = getDocumentClient();
  const windows: UserBudgetWindow[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': userPk(ownerSub),
          ':skPrefix': USER_BUDGET_SK_PREFIX,
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) windows.push(UserBudgetWindowSchema.parse(item));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return windows;
}
