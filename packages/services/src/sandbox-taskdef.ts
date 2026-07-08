import {
  DescribeTaskDefinitionCommand,
  type ECSClient,
  RegisterTaskDefinitionCommand,
  type RegisterTaskDefinitionCommandInput,
  type TaskDefinition,
} from '@aws-sdk/client-ecs';
import { agentRepo } from '@agent-village/data';
import { SANDBOX_BASE_IMAGE, type Agent, type SandboxTaskDefCache } from '@agent-village/shared';
import { logger } from './logger.js';

/** The manifest-controlled container; the only one whose image is swapped. */
const APP_CONTAINER_NAME = 'app';

/** Same repo URI, requested tag: replace everything after the last ':'. */
function swapImageTag(image: string, tag: string): string {
  const colon = image.lastIndexOf(':');
  const repoUri = colon > image.lastIndexOf('/') ? image.slice(0, colon) : image;
  return `${repoUri}:${tag}`;
}

/**
 * Clone a described task definition into a RegisterTaskDefinition input,
 * swapping only the app container's image tag. Everything security-relevant
 * survives byte-for-byte from the deployed source of truth — roles, cpu/memory
 * (so the single-size cost model holds), the egress-proxy sidecar with its
 * NET_ADMIN + healthcheck, the app's uid 10001 pin, dependsOn HEALTHY,
 * stopTimeout, and log config — while the read-only response fields
 * (taskDefinitionArn, revision, status, requiresAttributes, compatibilities,
 * registeredAt/By, deregisteredAt) are stripped by construction: only the
 * registrable fields are copied.
 */
export function cloneTaskDefinitionInput(
  described: TaskDefinition,
  imageTag: string,
): RegisterTaskDefinitionCommandInput {
  const app = described.containerDefinitions?.find((c) => c.name === APP_CONTAINER_NAME);
  if (!described.family || !app?.image) {
    throw new Error('described task definition is missing its family or app container image');
  }
  return {
    family: described.family,
    taskRoleArn: described.taskRoleArn,
    executionRoleArn: described.executionRoleArn,
    networkMode: described.networkMode,
    requiresCompatibilities: described.requiresCompatibilities,
    cpu: described.cpu,
    memory: described.memory,
    runtimePlatform: described.runtimePlatform,
    volumes: described.volumes,
    containerDefinitions: described.containerDefinitions?.map((container) =>
      container.name === APP_CONTAINER_NAME
        ? { ...container, image: swapImageTag(container.image ?? '', imageTag) }
        : container,
    ),
  };
}

/**
 * Best-effort cache write: a lost update just means one extra
 * Describe+Register on the agent's next run.
 */
async function persistTaskDefCache(agent: Agent, cache: SandboxTaskDefCache): Promise<void> {
  try {
    await agentRepo.updateAgent({
      agentId: agent.id,
      ownerSub: agent.ownerSub,
      patch: { sandboxTaskDef: cache },
    });
  } catch {
    logger.warn({
      event: 'sandbox.taskdef.cache_persist_failed',
      agentId: agent.id,
      image: cache.image,
    });
  }
}

/**
 * Resolve the task definition ARN a run should use. The `SANDBOX_BASE_IMAGE`
 * sentinel maps straight to the static ARN (zero AWS calls — exact pre-Phase-4
 * behavior). Any other tag reuses the ARN cached on the agent when it was
 * registered for the same image AND the same static revision (`baseArn`; a
 * platform redeploy bumps the env-injected revision, invalidating the cache);
 * otherwise the static definition is described, cloned with the requested tag,
 * re-registered under the same family (so the family-scoped ecs:RunTask and
 * iam:PassRole grants still match), and cached. Stale revisions stay ACTIVE:
 * revisions are free and deregistration buys no safety.
 */
export async function resolveTaskDefinition(
  ecs: ECSClient,
  agent: Agent,
  image: string,
  baseArn: string,
): Promise<string> {
  if (image === SANDBOX_BASE_IMAGE) return baseArn;
  const cached = agent.sandboxTaskDef;
  if (cached && cached.image === image && cached.baseArn === baseArn) return cached.arn;
  const described = await ecs.send(new DescribeTaskDefinitionCommand({ taskDefinition: baseArn }));
  if (!described.taskDefinition) {
    throw new Error('DescribeTaskDefinition returned no task definition');
  }
  const registered = await ecs.send(
    new RegisterTaskDefinitionCommand(cloneTaskDefinitionInput(described.taskDefinition, image)),
  );
  const arn = registered.taskDefinition?.taskDefinitionArn;
  if (!arn) throw new Error('RegisterTaskDefinition returned no task definition ARN');
  await persistTaskDefCache(agent, { image, baseArn, arn });
  logger.info({ event: 'sandbox.taskdef.registered', agentId: agent.id, image, taskDefArn: arn });
  return arn;
}
