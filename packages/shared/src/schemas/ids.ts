import { z } from 'zod';

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const zUlid = (): z.ZodString =>
  z.string().regex(ULID_REGEX, 'must be a Crockford-base32 ULID');

export const AgentId = zUlid().brand<'AgentId'>();
export type AgentId = z.infer<typeof AgentId>;

export const RunId = zUlid().brand<'RunId'>();
export type RunId = z.infer<typeof RunId>;

export const UserId = z.string().min(1).brand<'UserId'>();
export type UserId = z.infer<typeof UserId>;
