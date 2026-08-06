import type { Finding, RejectionReason } from './topology.js';

/**
 * The built slice of the spec's closed event set (spec 0002, "Audit surface").
 * Emitting a name outside this set is a type error; AC-M1.6 checks the journal too.
 */
export const EVENT_NAMES = [
  'topology.declared',
  'topology.rejected',
  'instance.started',
  'instance.stopped',
  'activation.started',
  'activation.ended',
  'volume.mounted',
  'volume.digest',
  'volume.reset',
  'crossing.requested',
  'crossing.decided',
  'crossing.performed',
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/** Closed reason enum for M1 egress decisions. Disjoint from ingress reasons (none exist in M1). */
export const DENY_REASONS = [
  'request-type-undeclared',
  'payload-schema-violation',
  'payload-size-exceeded',
] as const;

export type DenyReason = (typeof DENY_REASONS)[number];

export type Verdict = 'allow' | 'deny';

/** What produced a verdict. M1 has no auth environments, so only `program`. */
export type Decider = 'program';

/**
 * Principals. `agent-instance` carries the four-part identity from the spec's
 * terminology so a logical role and one of its incarnations are distinguishable.
 * `owner` is who declared the topology.
 */
export type Principal =
  | { kind: 'owner' }
  | { kind: 'runtime' }
  | { kind: 'bridge'; bridge: string }
  | {
      kind: 'agent-instance';
      application_instance: string;
      environment: string;
      activation: string;
      turn: string;
    };

/**
 * Stamped by the platform on every event. `turn` is null on platform lifecycle
 * events that no turn produced.
 */
export interface Envelope {
  seq: number;
  ts: string;
  event: EventName;
  application_instance: string;
  activation: string;
  flow: string;
  turn: string | null;
  principal: Principal;
}

export interface CrossingRequested extends Envelope {
  event: 'crossing.requested';
  crossing: string;
  bridge: string;
  request_type: string;
  request_digest: string;
}

export interface CrossingDecided extends Envelope {
  event: 'crossing.decided';
  crossing: string;
  bridge: string;
  request_type: string;
  request_digest: string;
  verdict: Verdict;
  decider: Decider;
  reason: DenyReason | null;
}

export interface CrossingPerformed extends Envelope {
  event: 'crossing.performed';
  crossing: string;
  bridge: string;
  request_type: string;
  result_digest: string;
}

export interface TopologyDeclared extends Envelope {
  event: 'topology.declared';
  topology_digest: string;
  application: string;
  /** The checker's surfaced weak spots (AC-1.6) — accepted, but never silent. */
  findings: Finding[];
}

/**
 * A declaration the checker refused (AC-2.2, AC-M2.7). One event per violated
 * rule: `reason` names the rule, the optional fields name the offending element.
 * The instance does not start.
 */
export interface TopologyRejected extends Envelope {
  event: 'topology.rejected';
  topology_digest: string | null;
  application: string | null;
  reason: RejectionReason;
  detail: string;
  volume: string | null;
  environment: string | null;
  bridge: string | null;
}

export interface InstanceStarted extends Envelope {
  event: 'instance.started';
  environment: string;
  container: string;
  /** Where this instance runs; must equal its activation's (AC-M3.3). */
  compute_unit: string;
}

export interface InstanceStopped extends Envelope {
  event: 'instance.stopped';
  environment: string;
  container: string;
  exit_code: number;
}

/**
 * Volume events carry the volume name and its version — for an ordinary
 * volume, the content digest of its host tree at the moment of the event.
 */
export interface VolumeMounted extends Envelope {
  event: 'volume.mounted';
  volume: string;
  version: string;
  environment: string;
  role: 'writer' | 'reader';
  mode: 'read-write' | 'read-only';
  subtree: string;
}

export interface VolumeDigest extends Envelope {
  event: 'volume.digest';
  volume: string;
  version: string;
}

/** A session volume destroyed at its flow boundary. `version` is the pre-reset digest (AC-M3.2). */
export interface VolumeReset extends Envelope {
  event: 'volume.reset';
  volume: string;
  version: string;
}

export interface ActivationStarted extends Envelope {
  event: 'activation.started';
  /** The one logical compute unit every environment of this activation runs on (AC-M3.3). */
  compute_unit: string;
}

export interface ActivationEnded extends Envelope {
  event: 'activation.ended';
  outcome: 'completed' | 'failed';
}

export type JournalEvent =
  | TopologyDeclared
  | TopologyRejected
  | InstanceStarted
  | InstanceStopped
  | ActivationStarted
  | ActivationEnded
  | VolumeMounted
  | VolumeDigest
  | VolumeReset
  | CrossingRequested
  | CrossingDecided
  | CrossingPerformed;
