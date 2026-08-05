import { readFileSync } from 'node:fs';

/**
 * The topology declaration schema (spec 0002, "Declaration and the checker").
 * This is the stable shape every later milestone adds declarations to; the
 * checker below refuses every declaration-time rule the spec names, each with
 * a reason naming the offending element, before anything runs.
 */
export interface Topology {
  version: 1;
  application: string;
  volumes: VolumeDecl[];
  environments: EnvironmentDecl[];
  bridges: BridgeDecl[];
}

export interface VolumeDecl {
  name: string;
  durability: 'ephemeral' | 'session' | 'durable';
  /** Write-only-via-crossing (spec: "Mediated volume"). Only a durable volume may declare this. */
  mediated: boolean;
  /** Holds credentials; mountable only into a credential-holding environment. */
  credential_class: boolean;
}

/**
 * The platform journal is never a declared volume; a mount may reference it by
 * this reserved name, and the checker refuses that mount anywhere an agent
 * instance lives.
 */
export const JOURNAL_VOLUME = 'journal';

export interface MountDecl {
  /** A declared volume name, or the reserved name `journal`. */
  volume: string;
  role: 'writer' | 'reader';
  mode: 'read-write' | 'read-only';
  /** Required by AC-1.5; parsed as absent so the rule, not the parser, owns the refusal. */
  subtree: string | null;
}

export interface EnvironmentDecl {
  name: string;
  agent_instance: boolean;
  credential_holding: boolean;
  request_types: string[];
  mounts: MountDecl[];
}

export type BridgeTarget =
  | { kind: 'network' }
  | { kind: 'environment'; environment: string }
  | { kind: 'volume'; volume: string };

export interface BridgeDecl {
  name: string;
  direction: 'egress';
  from: string;
  target: BridgeTarget;
  request_types: RequestTypeDecl[];
}

export type PolicyDecl = { kind: 'program'; max_message_bytes: number } | { kind: 'allow-all' };

export interface RequestTypeDecl {
  name: string;
  fidelity: 'parsed' | 'opaque';
  content: 'structured' | 'agent-authored';
  retryable: boolean;
  policy: PolicyDecl;
}

/**
 * Closed reason enum for `topology.rejected`: one member per declaration-time
 * rule the spec names, plus one for a declaration the schema cannot represent.
 */
export const REJECTION_REASONS = [
  'declaration-malformed',
  'volume-has-multiple-writers',
  'mount-role-mode-mismatch',
  'mediated-volume-mounted-read-write',
  'journal-mounted-into-agent-environment',
  'credential-volume-outside-credential-environment',
  'credential-environment-mounts-foreign-written-volume',
  'mount-missing-subtree',
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** One violated rule, naming the offending element. A rejection carries every violation found. */
export interface Violation {
  reason: RejectionReason;
  detail: string;
  volume?: string;
  environment?: string;
  bridge?: string;
}

/**
 * A weak spot the checker surfaces without refusing (spec AC-1.6): the
 * topology is accepted, and the finding travels on `topology.declared`.
 */
export interface Finding {
  finding: 'unmediated-write-path';
  detail: string;
  bridge: string;
  volume: string;
  request_type: string;
}

export type CheckResult =
  | { accepted: true; topology: Topology; findings: Finding[] }
  | { accepted: false; violations: Violation[] };

export class TopologyError extends Error {
  constructor(public readonly reason: string) {
    super(`topology refused: ${reason}`);
    this.name = 'TopologyError';
  }
}

export function loadTopology(path: string): CheckResult {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    return {
      accepted: false,
      violations: [
        {
          reason: 'declaration-malformed',
          detail: `unreadable declaration at ${path}: ${String(cause)}`,
        },
      ],
    };
  }
  return checkTopology(raw);
}

/**
 * Parse structurally, then run every rule. Structural malformation refuses
 * immediately; a well-formed topology collects every rule violation so the
 * declarer sees them all at once.
 */
export function checkTopology(raw: unknown): CheckResult {
  let topology: Topology;
  try {
    topology = parseTopology(raw);
  } catch (err) {
    if (err instanceof TopologyError) {
      return {
        accepted: false,
        violations: [{ reason: 'declaration-malformed', detail: err.reason }],
      };
    }
    throw err;
  }

  const violations = RULES.flatMap((rule) => rule(topology));
  if (violations.length > 0) {
    return { accepted: false, violations };
  }
  return { accepted: true, topology, findings: FINDING_RULES.flatMap((rule) => rule(topology)) };
}

type Rule = (topology: Topology) => Violation[];
type FindingRule = (topology: Topology) => Finding[];

/**
 * AC-1.1: a volume has at most one writer environment — including via distinct
 * subtrees, and counting a read-write mount as writing whatever role it claims,
 * so mode cannot smuggle a second write path past the role-based count.
 */
const oneWriterPerVolume: Rule = (topology) => {
  const writersOf = new Map<string, string[]>();
  for (const env of topology.environments) {
    for (const mount of env.mounts) {
      if (mount.role !== 'writer' && mount.mode !== 'read-write') continue;
      if (mount.volume === JOURNAL_VOLUME) continue;
      const writers = writersOf.get(mount.volume) ?? [];
      if (!writers.includes(env.name)) writers.push(env.name);
      writersOf.set(mount.volume, writers);
    }
  }
  return [...writersOf.entries()]
    .filter(([, writers]) => writers.length > 1)
    .map(([volume, writers]) => ({
      reason: 'volume-has-multiple-writers' as const,
      detail: `volume ${volume} declares ${String(writers.length)} writer environments: ${writers.join(', ')}`,
      volume,
    }));
};

/**
 * A mount's mode must be what its role declares: the writer of a volume is
 * read-write, a reader is read-only. Without this, a `reader` mount with mode
 * `read-write` is kernel-level write access held by an environment the
 * topology does not name as the writer — outside both the one-writer count
 * (AC-1.1) and the write lease the spec's no-two-concurrent-writers guarantee
 * hangs on.
 */
const mountModeMatchesRole: Rule = (topology) => {
  const violations: Violation[] = [];
  for (const env of topology.environments) {
    for (const mount of env.mounts) {
      const expected = mount.role === 'writer' ? 'read-write' : 'read-only';
      if (mount.mode !== expected) {
        violations.push({
          reason: 'mount-role-mode-mismatch',
          detail: `mount of volume ${mount.volume} into ${env.name} declares role ${mount.role} with mode ${mount.mode}; a ${mount.role} mount is ${expected}`,
          volume: mount.volume,
          environment: env.name,
        });
      }
    }
  }
  return violations;
};

/** AC-1.2: a mediated volume is write-only-via-crossing — no writer role, no read-write mount. */
const mediatedVolumesNeverWritable: Rule = (topology) => {
  const mediated = new Set(topology.volumes.filter((v) => v.mediated).map((v) => v.name));
  const violations: Violation[] = [];
  for (const env of topology.environments) {
    for (const mount of env.mounts) {
      if (!mediated.has(mount.volume)) continue;
      if (mount.role === 'writer' || mount.mode === 'read-write') {
        violations.push({
          reason: 'mediated-volume-mounted-read-write',
          detail: `mediated volume ${mount.volume} is mounted ${mount.role}/${mount.mode} into ${env.name}; every change to it must be a crossing`,
          volume: mount.volume,
          environment: env.name,
        });
      }
    }
  }
  return violations;
};

/** AC-1.3: the journal is never readable from an environment containing an agent instance. */
const journalUnreachableFromAgents: Rule = (topology) => {
  const violations: Violation[] = [];
  for (const env of topology.environments) {
    if (!env.agent_instance) continue;
    for (const mount of env.mounts) {
      if (mount.volume === JOURNAL_VOLUME) {
        violations.push({
          reason: 'journal-mounted-into-agent-environment',
          detail: `the journal is mounted into ${env.name}, which contains an agent instance`,
          environment: env.name,
        });
      }
    }
  }
  return violations;
};

/** AC-1.4, first half: a credential-class volume mounts only into a credential-holding environment. */
const credentialVolumesStayInCredentialEnvironments: Rule = (topology) => {
  const credential = new Set(topology.volumes.filter((v) => v.credential_class).map((v) => v.name));
  const violations: Violation[] = [];
  for (const env of topology.environments) {
    if (env.credential_holding) continue;
    for (const mount of env.mounts) {
      if (credential.has(mount.volume)) {
        violations.push({
          reason: 'credential-volume-outside-credential-environment',
          detail: `credential-class volume ${mount.volume} is mounted into ${env.name}, which is not declared credential-holding`,
          volume: mount.volume,
          environment: env.name,
        });
      }
    }
  }
  return violations;
};

/** AC-1.4, second half: a credential-holding environment mounts no volume another environment writes. */
const credentialEnvironmentsMountNoForeignWrites: Rule = (topology) => {
  const writerOf = new Map<string, string>();
  for (const env of topology.environments) {
    for (const mount of env.mounts) {
      if (mount.role === 'writer' && mount.volume !== JOURNAL_VOLUME) {
        writerOf.set(mount.volume, env.name);
      }
    }
  }
  const violations: Violation[] = [];
  for (const env of topology.environments) {
    if (!env.credential_holding) continue;
    for (const mount of env.mounts) {
      const writer = writerOf.get(mount.volume);
      if (writer !== undefined && writer !== env.name) {
        violations.push({
          reason: 'credential-environment-mounts-foreign-written-volume',
          detail: `credential-holding environment ${env.name} mounts volume ${mount.volume}, which environment ${writer} writes`,
          volume: mount.volume,
          environment: env.name,
        });
      }
    }
  }
  return violations;
};

/** AC-1.5: every mount declares a subtree. */
const mountsDeclareSubtrees: Rule = (topology) => {
  const violations: Violation[] = [];
  for (const env of topology.environments) {
    for (const mount of env.mounts) {
      if (mount.subtree === null) {
        violations.push({
          reason: 'mount-missing-subtree',
          detail: `mount of volume ${mount.volume} into ${env.name} declares no subtree`,
          volume: mount.volume,
          environment: env.name,
        });
      }
    }
  }
  return violations;
};

const RULES: Rule[] = [
  oneWriterPerVolume,
  mountModeMatchesRole,
  mediatedVolumesNeverWritable,
  journalUnreachableFromAgents,
  credentialVolumesStayInCredentialEnvironments,
  credentialEnvironmentsMountNoForeignWrites,
  mountsDeclareSubtrees,
];

/** AC-1.6: an `allow-all` mediated-write bridge is accepted and reported, never silent. */
const surfaceUnmediatedWritePaths: FindingRule = (topology) => {
  const findings: Finding[] = [];
  for (const bridge of topology.bridges) {
    if (bridge.target.kind !== 'volume') continue;
    const volume = bridge.target.volume;
    for (const rt of bridge.request_types) {
      if (rt.policy.kind === 'allow-all') {
        findings.push({
          finding: 'unmediated-write-path',
          detail: `bridge ${bridge.name} writes mediated volume ${volume} via ${rt.name} with policy class allow-all: every request will be allowed, so this is an unmediated write path with attributable recording only`,
          bridge: bridge.name,
          volume,
          request_type: rt.name,
        });
      }
    }
  }
  return findings;
};

const FINDING_RULES: FindingRule[] = [surfaceUnmediatedWritePaths];

function parseTopology(raw: unknown): Topology {
  const decl = asRecord(raw, 'topology');
  refuseUnknownKeys(
    decl,
    ['version', 'application', 'volumes', 'environments', 'bridges'],
    'topology',
  );
  if (decl.version !== 1) {
    throw new TopologyError(
      `version ${JSON.stringify(decl.version)} is not a declared schema version`,
    );
  }
  const application = asString(decl.application, 'application');

  const volumes = asArray(decl.volumes, 'volumes').map((v, i) =>
    parseVolume(v, `volumes[${String(i)}]`),
  );
  refuseDuplicates(
    volumes.map((v) => v.name),
    'volume',
  );
  for (const volume of volumes) {
    if (volume.name === JOURNAL_VOLUME) {
      throw new TopologyError(`volume name ${JOURNAL_VOLUME} is reserved for the platform journal`);
    }
  }
  const volumeNames = new Set(volumes.map((v) => v.name));

  const environments = asArray(decl.environments, 'environments').map((e, i) =>
    parseEnvironment(e, `environments[${String(i)}]`, volumeNames),
  );
  if (environments.length === 0) {
    throw new TopologyError('environments must declare at least one environment');
  }
  refuseDuplicates(
    environments.map((e) => e.name),
    'environment',
  );
  const environmentNames = new Set(environments.map((e) => e.name));

  const bridges = asArray(decl.bridges, 'bridges').map((b, i) =>
    parseBridge(b, `bridges[${String(i)}]`, environmentNames, volumes),
  );
  refuseDuplicates(
    bridges.map((b) => b.name),
    'bridge',
  );

  for (const env of environments) {
    const declared = new Set(
      bridges
        .filter((b) => b.from === env.name)
        .flatMap((b) => b.request_types.map((rt) => rt.name)),
    );
    for (const name of env.request_types) {
      if (!declared.has(name)) {
        throw new TopologyError(
          `environment ${env.name} invokes ${name}, which no bridge from it declares`,
        );
      }
    }
  }

  return { version: 1, application, volumes, environments, bridges };
}

function parseVolume(raw: unknown, at: string): VolumeDecl {
  const v = asRecord(raw, at);
  refuseUnknownKeys(v, ['name', 'durability', 'mediated', 'credential_class'], at);
  const durability = v.durability;
  if (durability !== 'ephemeral' && durability !== 'session' && durability !== 'durable') {
    throw new TopologyError(`${at}.durability must be ephemeral, session, or durable`);
  }
  const mediated = v.mediated === undefined ? false : asBoolean(v.mediated, `${at}.mediated`);
  if (mediated && durability !== 'durable') {
    throw new TopologyError(`${at}: only a durable volume may be mediated`);
  }
  return {
    name: asString(v.name, `${at}.name`),
    durability,
    mediated,
    credential_class:
      v.credential_class === undefined
        ? false
        : asBoolean(v.credential_class, `${at}.credential_class`),
  };
}

function parseEnvironment(raw: unknown, at: string, volumeNames: Set<string>): EnvironmentDecl {
  const e = asRecord(raw, at);
  refuseUnknownKeys(
    e,
    ['name', 'agent_instance', 'credential_holding', 'request_types', 'mounts'],
    at,
  );
  const name = asString(e.name, `${at}.name`);
  const mounts = asArray(e.mounts ?? [], `${at}.mounts`).map((m, i) =>
    parseMount(m, `${at}.mounts[${String(i)}]`, volumeNames),
  );
  return {
    name,
    agent_instance: asBoolean(e.agent_instance, `${at}.agent_instance`),
    credential_holding:
      e.credential_holding === undefined
        ? false
        : asBoolean(e.credential_holding, `${at}.credential_holding`),
    request_types: asStringArray(e.request_types, `${at}.request_types`),
    mounts,
  };
}

function parseMount(raw: unknown, at: string, volumeNames: Set<string>): MountDecl {
  const m = asRecord(raw, at);
  refuseUnknownKeys(m, ['volume', 'role', 'mode', 'subtree'], at);
  const volume = asString(m.volume, `${at}.volume`);
  if (volume !== JOURNAL_VOLUME && !volumeNames.has(volume)) {
    throw new TopologyError(`${at} mounts ${volume}, which no volume declaration names`);
  }
  const role = m.role;
  if (role !== 'writer' && role !== 'reader') {
    throw new TopologyError(`${at}.role must be writer or reader`);
  }
  const mode = m.mode;
  if (mode !== 'read-write' && mode !== 'read-only') {
    throw new TopologyError(`${at}.mode must be read-write or read-only`);
  }
  if (volume === JOURNAL_VOLUME && (role !== 'reader' || mode !== 'read-only')) {
    throw new TopologyError(`${at}: the journal has exactly one writer, the platform`);
  }
  const subtree =
    m.subtree === undefined || m.subtree === null ? null : asString(m.subtree, `${at}.subtree`);
  return { volume, role, mode, subtree };
}

function parseBridge(
  raw: unknown,
  at: string,
  environmentNames: Set<string>,
  volumes: VolumeDecl[],
): BridgeDecl {
  const b = asRecord(raw, at);
  refuseUnknownKeys(b, ['name', 'direction', 'from', 'target', 'request_types'], at);
  if (b.direction !== 'egress') {
    throw new TopologyError(`${at}: only egress bridges are declared yet; ingress arrives with M6`);
  }
  const from = asString(b.from, `${at}.from`);
  if (!environmentNames.has(from)) {
    throw new TopologyError(`${at}.from ${from} names no declared environment`);
  }
  const target = parseTarget(b.target, `${at}.target`, environmentNames, volumes);
  const rts = asArray(b.request_types, `${at}.request_types`);
  if (rts.length === 0) {
    throw new TopologyError(`${at}.request_types must be a non-empty array`);
  }
  const requestTypes = rts.map((entry, i) =>
    parseRequestType(entry, `${at}.request_types[${String(i)}]`),
  );
  refuseDuplicates(
    requestTypes.map((rt) => rt.name),
    `${at} request type`,
  );
  return {
    name: asString(b.name, `${at}.name`),
    direction: 'egress',
    from,
    target,
    request_types: requestTypes,
  };
}

function parseTarget(
  raw: unknown,
  at: string,
  environmentNames: Set<string>,
  volumes: VolumeDecl[],
): BridgeTarget {
  const t = asRecord(raw, at);
  refuseUnknownKeys(t, ['kind', 'environment', 'volume'], at);
  switch (t.kind) {
    case 'network':
      return { kind: 'network' };
    case 'environment': {
      const environment = asString(t.environment, `${at}.environment`);
      if (!environmentNames.has(environment)) {
        throw new TopologyError(`${at} names environment ${environment}, which is not declared`);
      }
      return { kind: 'environment', environment };
    }
    case 'volume': {
      const name = asString(t.volume, `${at}.volume`);
      const volume = volumes.find((v) => v.name === name);
      if (!volume) {
        throw new TopologyError(`${at} names volume ${name}, which is not declared`);
      }
      if (!volume.mediated) {
        throw new TopologyError(
          `${at}: volume ${name} is not mediated; the only volume crossing target is a mediated volume`,
        );
      }
      return { kind: 'volume', volume: name };
    }
    default:
      throw new TopologyError(`${at}.kind must be network, environment, or volume`);
  }
}

function parseRequestType(raw: unknown, at: string): RequestTypeDecl {
  const rt = asRecord(raw, at);
  refuseUnknownKeys(rt, ['name', 'fidelity', 'content', 'retryable', 'policy'], at);
  const fidelity = rt.fidelity;
  if (fidelity !== 'parsed' && fidelity !== 'opaque') {
    throw new TopologyError(`${at}.fidelity must be parsed or opaque`);
  }
  const content = rt.content;
  if (content !== 'structured' && content !== 'agent-authored') {
    throw new TopologyError(`${at}.content must be structured or agent-authored`);
  }
  return {
    name: asString(rt.name, `${at}.name`),
    fidelity,
    content,
    retryable: asBoolean(rt.retryable, `${at}.retryable`),
    policy: parsePolicy(rt.policy, `${at}.policy`),
  };
}

function parsePolicy(raw: unknown, at: string): PolicyDecl {
  const policy = asRecord(raw, at);
  refuseUnknownKeys(policy, ['kind', 'max_message_bytes'], at);
  switch (policy.kind) {
    case 'allow-all':
      if (policy.max_message_bytes !== undefined) {
        throw new TopologyError(`${at}: allow-all decides nothing, so it takes no parameters`);
      }
      return { kind: 'allow-all' };
    case 'program': {
      const max = policy.max_message_bytes;
      if (typeof max !== 'number' || !Number.isInteger(max) || max <= 0) {
        throw new TopologyError(`${at}.max_message_bytes must be a positive integer`);
      }
      return { kind: 'program', max_message_bytes: max };
    }
    default:
      throw new TopologyError(`${at}.kind must be program or allow-all`);
  }
}

function asRecord(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TopologyError(`${at} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, at: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TopologyError(`${at} must be an array`);
  }
  return value;
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

function refuseDuplicates(names: string[], what: string): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new TopologyError(`${what} ${name} is declared twice`);
    }
    seen.add(name);
  }
}

function refuseUnknownKeys(rec: Record<string, unknown>, known: string[], at: string): void {
  for (const key of Object.keys(rec)) {
    if (!known.includes(key)) {
      throw new TopologyError(`${at} declares ${key}, which the schema does not name`);
    }
  }
}
