import { userRepo } from '@agent-village/data';
import { UserId, type User } from '@agent-village/shared';

export interface CognitoClaims {
  sub: string;
  email: string;
  name?: string;
}

export async function ensureProfile(claims: CognitoClaims): Promise<User> {
  const cognitoSub = UserId.parse(claims.sub);
  return userRepo.ensureProfile({
    cognitoSub,
    email: claims.email,
    displayName: claims.name ?? claims.email,
  });
}
