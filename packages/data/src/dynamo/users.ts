import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { UserSchema, type User, type UserId } from '@agent-village/shared';
import { UserNotFoundError } from '@agent-village/domain';
import { getConfig, getDocumentClient } from './client.js';
import { USER_SK_PROFILE, userPk } from './keys.js';
import { isConditionalCheckFailed } from './errors-map.js';

export interface EnsureProfileInput {
  cognitoSub: UserId;
  email: string;
  displayName: string;
  now?: string;
}

export async function getProfile(cognitoSub: UserId): Promise<User | null> {
  const { tableName } = getConfig();
  const res = await getDocumentClient().send(
    new GetCommand({
      TableName: tableName,
      Key: { pk: userPk(cognitoSub), sk: USER_SK_PROFILE },
    }),
  );
  return res.Item ? UserSchema.parse(res.Item) : null;
}

export async function ensureProfile(input: EnsureProfileInput): Promise<User> {
  const existing = await getProfile(input.cognitoSub);
  if (existing) return existing;
  const profile: User = UserSchema.parse({
    cognitoSub: input.cognitoSub,
    email: input.email,
    displayName: input.displayName,
    createdAt: input.now ?? new Date().toISOString(),
  });
  const { tableName } = getConfig();
  await getDocumentClient().send(
    new PutCommand({
      TableName: tableName,
      Item: { pk: userPk(profile.cognitoSub), sk: USER_SK_PROFILE, ...profile },
    }),
  );
  return profile;
}

export interface UpdateProfileInput {
  cognitoSub: UserId;
  /** null clears the cap (REMOVE); a number sets it. Live limit — takes effect
   *  on the next reservation, never claws back an already-reserved run. */
  userMonthlyBudgetUsd: number | null;
}

export async function updateProfile(input: UpdateProfileInput): Promise<User> {
  const { tableName } = getConfig();
  const key = { pk: userPk(input.cognitoSub), sk: USER_SK_PROFILE };
  const command =
    input.userMonthlyBudgetUsd === null
      ? new UpdateCommand({
          TableName: tableName,
          Key: key,
          UpdateExpression: 'REMOVE userMonthlyBudgetUsd',
          ConditionExpression: 'attribute_exists(pk)',
          ReturnValues: 'ALL_NEW',
        })
      : new UpdateCommand({
          TableName: tableName,
          Key: key,
          UpdateExpression: 'SET userMonthlyBudgetUsd = :budget',
          ConditionExpression: 'attribute_exists(pk)',
          ExpressionAttributeValues: { ':budget': input.userMonthlyBudgetUsd },
          ReturnValues: 'ALL_NEW',
        });
  try {
    const res = await getDocumentClient().send(command);
    return UserSchema.parse(res.Attributes);
  } catch (err) {
    if (isConditionalCheckFailed(err)) throw new UserNotFoundError(input.cognitoSub);
    throw err;
  }
}

/**
 * Every user PROFILE item in the table. Used by the report-only budget-drift
 * job to enumerate scopes to recompute; not on any user-facing request path.
 * Paginates — fine at personal scale.
 */
export async function listAllProfiles(): Promise<User[]> {
  const { tableName } = getConfig();
  const client = getDocumentClient();
  const profiles: User[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await client.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: 'sk = :sk',
        ExpressionAttributeValues: { ':sk': USER_SK_PROFILE },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) profiles.push(UserSchema.parse(item));
    exclusiveStartKey = res.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return profiles;
}
