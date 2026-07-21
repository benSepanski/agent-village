import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { SpendLimitExceededError, UserBudgetExceededError } from '@agent-village/domain';
import type { AgentId, UserId } from '@agent-village/shared';
import { getConfig, getDocumentClient } from './client.js';
import { agentSk, USER_BUDGET_SK_PREFIX, userPk } from './keys.js';
import { isTransactionCanceled, unmarshallCancellationItem } from './errors-map.js';

/**
 * The user monthly-budget leg carried alongside an agent-scoped spend
 * transaction. Callers build this only when the owner's PROFILE has a live
 * `userMonthlyBudgetUsd` set — its absence is what keeps budget-less owners
 * on the legacy single-item `reserveSpend`/`finalizeSpend` path (agents.ts).
 */
export interface UserBudgetLeg {
  /** BUDGET#<YYYY-MM> sort key — persisted verbatim as run.budgetWindowKey. */
  windowKey: string;
  /** The owner's live cap, read from the profile per call (never snapshotted). */
  limitUsd: number;
  /** ISO timestamp used both for the window's updatedAt and to derive `month`. */
  now: string;
}

function agentKey(ownerSub: UserId, agentId: AgentId): { pk: string; sk: string } {
  return { pk: userPk(ownerSub), sk: agentSk(agentId) };
}

interface ReserveSpendTxInput {
  agentId: AgentId;
  ownerSub: UserId;
  estimateUsd: number;
  userBudget: UserBudgetLeg;
}

/**
 * Maps a cancelled reserve transaction to the right domain error. Index 0 is
 * always the AGENT leg, index 1 the WINDOW leg (see the TransactItems order
 * below) — when both conditions fail, the agent cap wins, preserving the
 * pre-existing hard-cap guarantee.
 */
function throwReserveCancellation(err: unknown, input: ReserveSpendTxInput): never {
  if (!isTransactionCanceled(err)) throw err;
  const reasons = err.CancellationReasons ?? [];
  if (reasons[0]?.Code === 'ConditionalCheckFailed') {
    const item = unmarshallCancellationItem(reasons[0]);
    throw new SpendLimitExceededError({
      agentId: input.agentId,
      spendLimitUsd: Number(item['spendLimitUsd'] ?? 0),
      spendUsedUsd: Number(item['spendUsedUsd'] ?? 0),
      estimateUsd: input.estimateUsd,
    });
  }
  if (reasons[1]?.Code === 'ConditionalCheckFailed') {
    const item = unmarshallCancellationItem(reasons[1]);
    throw new UserBudgetExceededError({
      ownerSub: input.ownerSub,
      windowKey: input.userBudget.windowKey,
      budgetLimitUsd: input.userBudget.limitUsd,
      spentUsd: Number(item['spentUsd'] ?? 0),
      estimateUsd: input.estimateUsd,
    });
  }
  throw err;
}

/**
 * Two-item TransactWrite: the AGENT leg (unchanged condition/expression from
 * the legacy single-item reserveSpend) plus a lazily-upserted USER WINDOW leg.
 * `if_not_exists(spentUsd, :zero)` bootstraps a missing window at 0, and
 * because the sk is period-keyed (BUDGET#<month>), a new month is simply a
 * new item — no reset logic, no cron.
 */
export async function reserveSpendWithUserBudget(input: ReserveSpendTxInput): Promise<void> {
  const { tableName } = getConfig();
  const ub = input.userBudget;
  try {
    await getDocumentClient().send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Update: {
              TableName: tableName,
              Key: agentKey(input.ownerSub, input.agentId),
              UpdateExpression: 'ADD spendUsedUsd :est',
              ConditionExpression: 'spendUsedUsd + :est <= spendLimitUsd',
              ExpressionAttributeValues: { ':est': input.estimateUsd },
              ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
            },
          },
          {
            Update: {
              TableName: tableName,
              Key: { pk: userPk(input.ownerSub), sk: ub.windowKey },
              UpdateExpression:
                'SET budgetLimitUsd = :lim, #m = :month, ownerSub = :own, updatedAt = :now ADD spentUsd :est',
              ConditionExpression: 'if_not_exists(spentUsd, :zero) + :est <= :lim',
              ExpressionAttributeNames: { '#m': 'month' },
              ExpressionAttributeValues: {
                ':est': input.estimateUsd,
                ':lim': ub.limitUsd,
                ':zero': 0,
                // Derived from the pinned windowKey, not from `ub.now` — a
                // cross-rollover reservation (run started in month A, call
                // lands in month B) must not overwrite month A's window item
                // with month B's label (see M3 verification MINOR 3).
                ':month': ub.windowKey.slice(USER_BUDGET_SK_PREFIX.length),
                ':own': input.ownerSub,
                ':now': ub.now,
              },
              ReturnValuesOnConditionCheckFailure: 'ALL_OLD',
            },
          },
        ],
      }),
    );
  } catch (err) {
    throwReserveCancellation(err, input);
  }
}

interface FinalizeSpendTxInput {
  agentId: AgentId;
  ownerSub: UserId;
  deltaUsd: number;
  userWindowKey: string;
}

/**
 * Two-item TransactWrite settling both legs atomically — no
 * ConditionExpression, since finalize must always succeed (it is invoked
 * from claim-gated exactly-once paths; the claim, not this write, is what
 * prevents double-application).
 */
export async function finalizeSpendWithUserBudget(input: FinalizeSpendTxInput): Promise<void> {
  const { tableName } = getConfig();
  await getDocumentClient().send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Update: {
            TableName: tableName,
            Key: agentKey(input.ownerSub, input.agentId),
            UpdateExpression: 'ADD spendUsedUsd :d',
            ExpressionAttributeValues: { ':d': input.deltaUsd },
          },
        },
        {
          Update: {
            TableName: tableName,
            Key: { pk: userPk(input.ownerSub), sk: input.userWindowKey },
            UpdateExpression: 'ADD spentUsd :d',
            ExpressionAttributeValues: { ':d': input.deltaUsd },
          },
        },
      ],
    }),
  );
}
