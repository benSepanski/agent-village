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
