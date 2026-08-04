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
    policy: {
        kind: 'program';
        max_message_bytes: number;
    };
}
/** A declaration the M1 checker cannot represent. The topology is refused before anything runs. */
export declare class TopologyError extends Error {
    readonly reason: string;
    constructor(reason: string);
}
export declare function loadTopology(path: string): Topology;
/**
 * The M1-minimal checker: accepts the fixture shape and refuses only what it
 * cannot represent, each refusal with a reason. Full rejection rules are M2.
 */
export declare function checkTopology(raw: unknown): Topology;
