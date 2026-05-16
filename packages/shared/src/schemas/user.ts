import { z } from 'zod';
import { UserId } from './ids.js';

export const UserSchema = z.object({
  cognitoSub: UserId,
  email: z.string().email(),
  displayName: z.string().min(1).max(120),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof UserSchema>;
