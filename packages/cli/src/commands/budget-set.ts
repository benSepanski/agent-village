import { UpdateUserInput } from '@agent-village/shared';
import { client } from '../client.js';
import { kv } from '../format.js';
import { formatZodError } from './zod-errors.js';

interface UpdatedUser {
  cognitoSub: string;
  userMonthlyBudgetUsd?: number;
}

function parseUsd(usd: string): number {
  const parsed = Number(usd);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid input:\n  usd: "${usd}" is not a number`);
  }
  const result = UpdateUserInput.safeParse({ userMonthlyBudgetUsd: parsed });
  if (!result.success) throw new Error(formatZodError(result.error));
  return result.data.userMonthlyBudgetUsd as number;
}

/** Parse the usd argument locally (fail fast) then PATCH /me/budget. */
export async function budgetSet(usd: string): Promise<string> {
  const userMonthlyBudgetUsd = parseUsd(usd);
  const c = await client();
  const updated = await c.patch<UpdatedUser>('/me/budget', { userMonthlyBudgetUsd });
  return kv([
    [
      'limit',
      updated.userMonthlyBudgetUsd === undefined
        ? '—'
        : `$${updated.userMonthlyBudgetUsd.toFixed(2)}`,
    ],
    ['action', 'updated'],
  ]);
}
