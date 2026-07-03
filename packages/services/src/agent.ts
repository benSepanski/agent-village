import { agentRepo, secrets, type AgentPatch } from '@agent-village/data';
import { AgentNotFoundError, validateCron } from '@agent-village/domain';
import {
  AgentId as AgentIdSchema,
  AgentSchema,
  type Agent,
  type AgentId,
  type CreateAgentInput,
  type UpdateAgentInput,
  type UserId,
} from '@agent-village/shared';
import { logger } from './logger.js';
import { removeSchedule, upsertSchedule } from './scheduling.js';
import { ulid } from './ulid.js';

const ENV = process.env['AV_ENV'] ?? 'dev';

export async function listMyAgents(ownerSub: UserId): Promise<Agent[]> {
  return agentRepo.listMyAgents(ownerSub);
}

export async function getMyAgent(ownerSub: UserId, agentId: AgentId): Promise<Agent> {
  const agent = await agentRepo.getAgent(ownerSub, agentId);
  if (!agent) throw new AgentNotFoundError(agentId);
  return agent;
}

interface BuildAgentArgs {
  ownerSub: UserId;
  agentId: AgentId;
  input: CreateAgentInput;
  secretArn: string;
  schedule: string | null;
  now: string;
}

function buildAgent(args: BuildAgentArgs): Agent {
  return AgentSchema.parse({
    id: args.agentId,
    ownerSub: args.ownerSub,
    name: args.input.name,
    model: args.input.model,
    systemPrompt: args.input.systemPrompt,
    schedule: args.schedule,
    spendLimitUsd: args.input.spendLimitUsd,
    spendUsedUsd: 0,
    anthropicSecretArn: args.secretArn,
    status: args.input.status ?? 'active',
    manifest: args.input.manifest ?? null,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

export async function createAgent(ownerSub: UserId, input: CreateAgentInput): Promise<Agent> {
  const schedule = validateCron(input.schedule);
  const agentId = AgentIdSchema.parse(ulid());
  const stored = await secrets.storeAnthropicKey(agentId, input.anthropicApiKey, ENV);
  let agent: Agent;
  try {
    agent = buildAgent({
      ownerSub,
      agentId,
      input,
      secretArn: stored.arn,
      schedule,
      now: new Date().toISOString(),
    });
    await agentRepo.createAgent(agent);
  } catch (err) {
    await secrets.deleteAnthropicKey(stored.arn).catch(() => undefined);
    throw err;
  }
  if (schedule && agent.status === 'active') {
    await upsertSchedule(agentId, schedule);
  }
  logger.info({ event: 'agent.created', agentId, userId: ownerSub });
  return agent;
}

function buildPatch(
  input: UpdateAgentInput,
  validatedSchedule: string | null | undefined,
): AgentPatch {
  const patch: AgentPatch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.model !== undefined) patch.model = input.model;
  if (input.systemPrompt !== undefined) patch.systemPrompt = input.systemPrompt;
  if (input.schedule !== undefined) patch.schedule = validatedSchedule ?? null;
  if (input.spendLimitUsd !== undefined) patch.spendLimitUsd = input.spendLimitUsd;
  if (input.status !== undefined) patch.status = input.status;
  if (input.manifest !== undefined) patch.manifest = input.manifest;
  return patch;
}

async function syncSchedule(
  agentId: AgentId,
  current: Agent,
  input: UpdateAgentInput,
): Promise<void> {
  if (input.schedule === undefined && input.status === undefined) return;
  const newSchedule =
    input.schedule === undefined ? current.schedule : validateCron(input.schedule);
  const newStatus = input.status ?? current.status;
  if (newSchedule && newStatus === 'active') {
    await upsertSchedule(agentId, newSchedule);
  } else {
    await removeSchedule(agentId);
  }
}

export async function updateAgent(
  ownerSub: UserId,
  agentId: AgentId,
  input: UpdateAgentInput,
): Promise<Agent> {
  const current = await agentRepo.getAgent(ownerSub, agentId);
  if (!current) throw new AgentNotFoundError(agentId);
  const validatedSchedule = input.schedule === undefined ? undefined : validateCron(input.schedule);
  if (input.anthropicApiKey !== undefined) {
    await secrets.rotateAnthropicKey(current.anthropicSecretArn, input.anthropicApiKey);
  }
  await syncSchedule(agentId, current, input);
  const updated = await agentRepo.updateAgent({
    agentId,
    ownerSub,
    patch: buildPatch(input, validatedSchedule),
  });
  logger.info({ event: 'agent.updated', agentId, userId: ownerSub });
  return updated;
}

export async function deleteAgent(ownerSub: UserId, agentId: AgentId): Promise<void> {
  const current = await agentRepo.getAgent(ownerSub, agentId);
  if (!current) throw new AgentNotFoundError(agentId);
  await removeSchedule(agentId);
  await secrets.deleteAnthropicKey(current.anthropicSecretArn).catch(() => undefined);
  await agentRepo.deleteAgent(ownerSub, agentId);
  logger.info({ event: 'agent.deleted', agentId, userId: ownerSub });
}
