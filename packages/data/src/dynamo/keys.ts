export const USER_SK_PROFILE = 'PROFILE' as const;
export const AGENT_SK_PREFIX = 'AGENT#' as const;
export const AGENT_GSI1SK_META = 'META' as const;
export const RUN_SK_PREFIX = 'RUN#' as const;
export const GSI1_NAME = 'gsi1' as const;

export const userPk = (cognitoSub: string): string => `USER#${cognitoSub}`;
export const agentSk = (agentId: string): string => `${AGENT_SK_PREFIX}${agentId}`;
export const agentGsi1pk = (agentId: string): string => `AGENT#${agentId}`;
export const agentPk = (agentId: string): string => `AGENT#${agentId}`;
export const runSk = (createdAt: string, runId: string): string =>
  `${RUN_SK_PREFIX}${createdAt}#${runId}`;
export const runGsi1sk = (createdAt: string): string => `${RUN_SK_PREFIX}${createdAt}`;

/**
 * Sort-key prefix matching every run created in `date`'s UTC calendar month.
 * Run sort keys embed the ISO `createdAt` (always UTC, `YYYY-MM-DDT…`), so a
 * `begins_with` on `RUN#YYYY-MM-` is an exact month range — the trailing dash
 * pins the day separator so e.g. `2026-1` can never match `2026-10`.
 */
export const runMonthSkPrefix = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${RUN_SK_PREFIX}${year}-${month}-`;
};
