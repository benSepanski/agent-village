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

export class RunNotFoundError extends Error {
  readonly statusCode = 404;
  readonly details: { agentId: string; runId: string };

  constructor(agentId: string, runId: string) {
    super(`run not found: ${runId}`);
    this.name = 'RunNotFoundError';
    this.details = { agentId, runId };
  }
}

export class ReplayPromptMismatchError extends Error {
  readonly statusCode = 409;
  readonly details: { agentId: string; runId: string };

  constructor(agentId: string, runId: string) {
    super(
      `cannot replay run ${runId}: the agent's system prompt has changed since the original run`,
    );
    this.name = 'ReplayPromptMismatchError';
    this.details = { agentId, runId };
  }
}

export class AgentRunInProgressError extends Error {
  readonly statusCode = 409;
  readonly details: { agentId: string };

  constructor(agentId: string) {
    super(`a run is already in progress for agent ${agentId}`);
    this.name = 'AgentRunInProgressError';
    this.details = { agentId };
  }
}

export class GrantSecretOwnershipError extends Error {
  readonly statusCode = 400;
  readonly details: { agentId: string; secretName: string };

  constructor(agentId: string, secretName: string) {
    super(`grant secret "${secretName}" is not under agent ${agentId}'s own secret prefix`);
    this.name = 'GrantSecretOwnershipError';
    this.details = { agentId, secretName };
  }
}

export class SecretPendingDeletionError extends Error {
  readonly statusCode = 409;
  readonly details: { agentId: string; secretName: string };

  constructor(agentId: string, secretName: string) {
    super(
      `secret "${secretName}" for agent ${agentId} is scheduled for deletion in Secrets Manager; retry shortly`,
    );
    this.name = 'SecretPendingDeletionError';
    this.details = { agentId, secretName };
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
