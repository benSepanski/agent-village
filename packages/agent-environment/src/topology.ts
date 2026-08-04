import { readFileSync } from 'node:fs';

/**
 * The M1 slice of a topology declaration: one environment holding a probe agent,
 * one egress bridge with program-decided request types. Everything the spec
 * declares beyond this (volumes, mounts, ingress, invariants) arrives in M2+.
 */
export interface Topology {
  version: 'm1';
  application: string;
  environment: EnvironmentDecl;
  bridge: BridgeDecl;
}

export interface EnvironmentDecl {
  name: string;
  agent_instance: boolean;
  request_types: string[];
}

export interface BridgeDecl {
  name: string;
  direction: 'egress';
  from: string;
  target: 'network';
  request_types: RequestTypeDecl[];
}

export interface RequestTypeDecl {
  name: string;
  fidelity: 'parsed';
  content: 'structured';
  retryable: boolean;
  policy: { kind: 'program'; max_message_bytes: number };
}

/** A declaration the M1 checker cannot represent. The topology is refused before anything runs. */
export class TopologyError extends Error {
  constructor(public readonly reason: string) {
    super(`topology refused: ${reason}`);
    this.name = 'TopologyError';
  }
}

export function loadTopology(path: string): Topology {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new TopologyError(`unreadable declaration at ${path}: ${String(cause)}`);
  }
  return checkTopology(raw);
}

/**
 * The M1-minimal checker: accepts the fixture shape and refuses only what it
 * cannot represent, each refusal with a reason. Full rejection rules are M2.
 */
export function checkTopology(raw: unknown): Topology {
  const decl = asRecord(raw, 'topology');
  refuseUnknownKeys(decl, ['version', 'application', 'environment', 'bridge'], 'topology');
  if (decl.version !== 'm1') {
    throw new TopologyError(`version ${JSON.stringify(decl.version)} is not representable in M1`);
  }
  const application = asString(decl.application, 'application');

  const env = asRecord(decl.environment, 'environment');
  refuseUnknownKeys(env, ['name', 'agent_instance', 'request_types'], 'environment');
  const environment: EnvironmentDecl = {
    name: asString(env.name, 'environment.name'),
    agent_instance: asBoolean(env.agent_instance, 'environment.agent_instance'),
    request_types: asStringArray(env.request_types, 'environment.request_types'),
  };

  const br = asRecord(decl.bridge, 'bridge');
  refuseUnknownKeys(br, ['name', 'direction', 'from', 'target', 'request_types'], 'bridge');
  if (br.direction !== 'egress') {
    throw new TopologyError('only egress bridges are representable in M1');
  }
  if (br.target !== 'network') {
    throw new TopologyError('only the network crossing target is representable in M1');
  }
  const from = asString(br.from, 'bridge.from');
  if (from !== environment.name) {
    throw new TopologyError(`bridge.from ${from} names no declared environment`);
  }
  if (!Array.isArray(br.request_types) || br.request_types.length === 0) {
    throw new TopologyError('bridge.request_types must be a non-empty array');
  }
  const requestTypes = br.request_types.map((entry, i) =>
    checkRequestType(entry, `bridge.request_types[${i}]`),
  );

  const declared = new Set(requestTypes.map((rt) => rt.name));
  for (const name of environment.request_types) {
    if (!declared.has(name)) {
      throw new TopologyError(`environment invokes ${name}, which no bridge declares`);
    }
  }

  return {
    version: 'm1',
    application,
    environment,
    bridge: {
      name: asString(br.name, 'bridge.name'),
      direction: 'egress',
      from,
      target: 'network',
      request_types: requestTypes,
    },
  };
}

function checkRequestType(raw: unknown, at: string): RequestTypeDecl {
  const rt = asRecord(raw, at);
  refuseUnknownKeys(rt, ['name', 'fidelity', 'content', 'retryable', 'policy'], at);
  if (rt.fidelity !== 'parsed') {
    throw new TopologyError(`${at}: only fidelity "parsed" is representable in M1`);
  }
  if (rt.content !== 'structured') {
    throw new TopologyError(`${at}: only content "structured" is representable in M1`);
  }
  const policy = asRecord(rt.policy, `${at}.policy`);
  refuseUnknownKeys(policy, ['kind', 'max_message_bytes'], `${at}.policy`);
  if (policy.kind !== 'program') {
    throw new TopologyError(`${at}: only program-decided policies are representable in M1`);
  }
  const max = policy.max_message_bytes;
  if (typeof max !== 'number' || !Number.isInteger(max) || max <= 0) {
    throw new TopologyError(`${at}.policy.max_message_bytes must be a positive integer`);
  }
  return {
    name: asString(rt.name, `${at}.name`),
    fidelity: 'parsed',
    content: 'structured',
    retryable: asBoolean(rt.retryable, `${at}.retryable`),
    policy: { kind: 'program', max_message_bytes: max },
  };
}

function asRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TopologyError(`${at} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TopologyError(`${at} must be a non-empty string`);
  }
  return value;
}

function asBoolean(value: unknown, at: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TopologyError(`${at} must be a boolean`);
  }
  return value;
}

function asStringArray(value: unknown, at: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new TopologyError(`${at} must be an array of strings`);
  }
  return value as string[];
}

function refuseUnknownKeys(rec: Record<string, unknown>, known: string[], at: string): void {
  for (const key of Object.keys(rec)) {
    if (!known.includes(key)) {
      throw new TopologyError(`${at} declares ${key}, which M1 cannot represent`);
    }
  }
}
