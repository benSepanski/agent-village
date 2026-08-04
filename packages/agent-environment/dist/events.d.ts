/**
 * The M1 slice of the spec's closed event set (spec 0002, "Audit surface").
 * Emitting a name outside this set is a type error; AC-M1.6 checks the journal too.
 */
export declare const EVENT_NAMES: readonly ["topology.declared", "instance.started", "activation.started", "activation.ended", "crossing.requested", "crossing.decided", "crossing.performed"];
export type EventName = (typeof EVENT_NAMES)[number];
/** Closed reason enum for M1 egress decisions. Disjoint from ingress reasons (none exist in M1). */
export declare const DENY_REASONS: readonly ["request-type-undeclared", "payload-schema-violation", "payload-size-exceeded"];
export type DenyReason = (typeof DENY_REASONS)[number];
export type Verdict = 'allow' | 'deny';
/** What produced a verdict. M1 has no auth environments, so only `program`. */
export type Decider = 'program';
/**
 * M1 principals. `agent-instance` carries the four-part identity from the spec's
 * terminology so a logical role and one of its incarnations are distinguishable.
 */
export type Principal = {
    kind: 'runtime';
} | {
    kind: 'bridge';
    bridge: string;
} | {
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
}
export interface InstanceStarted extends Envelope {
    event: 'instance.started';
    environment: string;
    container: string;
}
export interface ActivationStarted extends Envelope {
    event: 'activation.started';
}
export interface ActivationEnded extends Envelope {
    event: 'activation.ended';
    outcome: 'completed' | 'failed';
}
export type JournalEvent = TopologyDeclared | InstanceStarted | ActivationStarted | ActivationEnded | CrossingRequested | CrossingDecided | CrossingPerformed;
