export interface SpendLimitDetails {
  agentId: string;
  spendLimitUsd: number;
  spendUsedUsd: number;
  estimateUsd: number;
}

export class SpendLimitExceededError extends Error {
  readonly statusCode = 402;
  readonly details: SpendLimitDetails;

  constructor(details: SpendLimitDetails) {
    super(`spend limit exceeded for agent ${details.agentId}`);
    this.name = 'SpendLimitExceededError';
    this.details = details;
  }
}

export class AgentNotFoundError extends Error {
  readonly statusCode = 404;
  readonly details: { agentId: string };

  constructor(agentId: string) {
    super(`agent not found: ${agentId}`);
    this.name = 'AgentNotFoundError';
    this.details = { agentId };
  }
}

export class InvalidScheduleError extends Error {
  readonly statusCode = 400;
  readonly details: { schedule: string; reason?: string };

  constructor(schedule: string, reason?: string) {
    super(`invalid schedule expression: ${schedule}${reason ? ` (${reason})` : ''}`);
    this.name = 'InvalidScheduleError';
    this.details = reason === undefined ? { schedule } : { schedule, reason };
  }
}
