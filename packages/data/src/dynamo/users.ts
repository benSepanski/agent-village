import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { UserSchema, type User, type UserId } from '@agent-village/shared';
import { getConfig, getDocumentClient } from './client.js';
import { USER_SK_PROFILE, userPk } from './keys.js';

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
