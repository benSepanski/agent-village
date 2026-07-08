import { describe, expect, it, vi } from 'vitest';
import type { TaskDefinition } from '@aws-sdk/client-ecs';

vi.mock('@agent-village/data', () => ({ agentRepo: { updateAgent: vi.fn() } }));

import { cloneTaskDefinitionInput } from './sandbox-taskdef.js';

const BASE_REPO = '000000000000.dkr.ecr.us-east-1.amazonaws.com/agent-village-dev-sandbox-base';
const LOG_CONFIG = {
  logDriver: 'awslogs',
  options: { 'awslogs-group': 'agent-village-dev-sandbox', 'awslogs-stream-prefix': 'sandbox' },
};

/**
 * Faithful miniature of what DescribeTaskDefinition returns for the deployed
 * SandboxStack definition: registrable fields plus the read-only response
 * fields the clone must strip.
 */
const described: TaskDefinition = {
  taskDefinitionArn: 'arn:aws:ecs:us-east-1:0:task-definition/agent-village-dev-sandbox:7',
  family: 'agent-village-dev-sandbox',
  revision: 7,
  status: 'ACTIVE',
  taskRoleArn: 'arn:aws:iam::0:role/sandbox-task',
  executionRoleArn: 'arn:aws:iam::0:role/sandbox-exec',
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  cpu: '256',
  memory: '512',
  runtimePlatform: { cpuArchitecture: 'ARM64', operatingSystemFamily: 'LINUX' },
  volumes: [],
  requiresAttributes: [{ name: 'ecs.capability.execution-role-ecr-pull' }],
  compatibilities: ['EC2', 'FARGATE'],
  registeredAt: new Date('2026-07-01T00:00:00.000Z'),
  registeredBy: 'arn:aws:iam::0:root',
  containerDefinitions: [
    {
      name: 'app',
      image: `${BASE_REPO}:latest`,
      essential: true,
      user: '10001',
      stopTimeout: 120,
      dependsOn: [{ containerName: 'egress-proxy', condition: 'HEALTHY' }],
      environment: [{ name: 'AV_ENV', value: 'dev' }],
      logConfiguration: LOG_CONFIG,
    },
    {
      name: 'egress-proxy',
      image: '000000000000.dkr.ecr.us-east-1.amazonaws.com/agent-village-dev-egress-proxy:latest',
      essential: true,
      linuxParameters: { capabilities: { add: ['NET_ADMIN'] } },
      healthCheck: {
        command: ['CMD-SHELL', 'test -f /tmp/av-egress-ready'],
        interval: 5,
        timeout: 2,
        retries: 3,
        startPeriod: 30,
      },
      environment: [{ name: 'AV_ENV', value: 'dev' }],
      logConfiguration: LOG_CONFIG,
    },
  ],
};

describe('cloneTaskDefinitionInput', () => {
  const clone = cloneTaskDefinitionInput(described, 'apply-bot');
  const app = clone.containerDefinitions?.find((c) => c.name === 'app');
  const proxy = clone.containerDefinitions?.find((c) => c.name === 'egress-proxy');

  it('swaps only the app image tag, on the same repo URI', () => {
    expect(app?.image).toBe(`${BASE_REPO}:apply-bot`);
    // The proxy container survives byte-for-byte (same object, image included).
    expect(proxy).toBe(described.containerDefinitions?.[1]);
  });

  it('keeps the registrable task-level fields (family, roles, size, platform)', () => {
    expect(clone.family).toBe('agent-village-dev-sandbox');
    expect(clone.taskRoleArn).toBe('arn:aws:iam::0:role/sandbox-task');
    expect(clone.executionRoleArn).toBe('arn:aws:iam::0:role/sandbox-exec');
    expect(clone.networkMode).toBe('awsvpc');
    expect(clone.requiresCompatibilities).toEqual(['FARGATE']);
    // Same cpu/memory: sandboxEstimate/reconcileComputeSpend's single-task-size
    // assumption must keep holding for cloned definitions.
    expect(clone.cpu).toBe('256');
    expect(clone.memory).toBe('512');
    expect(clone.runtimePlatform).toEqual({
      cpuArchitecture: 'ARM64',
      operatingSystemFamily: 'LINUX',
    });
    expect(clone.volumes).toEqual([]);
  });

  it('strips the read-only DescribeTaskDefinition response fields', () => {
    for (const key of [
      'taskDefinitionArn',
      'revision',
      'status',
      'requiresAttributes',
      'compatibilities',
      'registeredAt',
      'registeredBy',
      'deregisteredAt',
    ]) {
      expect(clone, key).not.toHaveProperty(key);
    }
  });

  it('preserves the sandbox security posture on the app container', () => {
    // The lifecycle handler and the proxy override look containers up by name.
    expect(clone.containerDefinitions?.map((c) => c.name)).toEqual(['app', 'egress-proxy']);
    // uid pin: a derived image cannot revert to root and setuid to the proxy uid.
    expect(app?.user).toBe('10001');
    // The app must never hold NET_ADMIN (only the proxy may touch iptables).
    expect(app?.linuxParameters).toBeUndefined();
    expect(app?.essential).toBe(true);
    expect(app?.stopTimeout).toBe(120);
    expect(app?.dependsOn).toEqual([{ containerName: 'egress-proxy', condition: 'HEALTHY' }]);
    expect(app?.logConfiguration).toEqual(LOG_CONFIG);
  });

  it('preserves the egress-proxy sidecar posture', () => {
    expect(proxy?.linuxParameters).toEqual({ capabilities: { add: ['NET_ADMIN'] } });
    expect(proxy?.healthCheck?.command).toEqual(['CMD-SHELL', 'test -f /tmp/av-egress-ready']);
    expect(proxy?.essential).toBe(true);
    expect(proxy?.logConfiguration).toEqual(LOG_CONFIG);
  });

  it('throws when the described definition is missing its family or app image', () => {
    expect(() => cloneTaskDefinitionInput({ ...described, family: undefined }, 't')).toThrow(
      /missing/,
    );
    expect(() =>
      cloneTaskDefinitionInput(
        { ...described, containerDefinitions: [{ name: 'egress-proxy' }] },
        't',
      ),
    ).toThrow(/missing/);
  });
});
