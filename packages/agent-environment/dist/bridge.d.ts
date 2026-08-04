import type { DenyReason } from './events.js';
import { type Journal } from './journal.js';
import type { Topology } from './topology.js';
/**
 * Wire protocol on the environment-side channel: one JSON object per line.
 * The channel is a Unix socket mounted into the environment — deliberately not
 * routable, which is part of the no-raw-network claim (AC-M1.1).
 */
export interface InvokeRequest {
    op: 'invoke';
    request_type: string;
    payload: unknown;
}
export type InvokeResponse = {
    ok: true;
    crossing: string;
    result: unknown;
} | {
    ok: false;
    crossing: string;
    verdict: 'deny';
    reason: DenyReason;
};
export interface EchoPayload {
    message: string;
}
/**
 * The egress bridge, plus the platform side of the harness in M1: the declared
 * request-type check (AC-M1.4) runs here, on the platform side of the channel,
 * because a record written from inside the environment could not be trusted to
 * exist (AC-M1.5). Identity on events is stamped from the topology and the
 * runtime's own identifiers, never from anything the environment claims.
 */
export declare class Bridge {
    private readonly topology;
    private readonly journal;
    private readonly turn;
    private readonly identity;
    private crossings;
    private server;
    constructor(topology: Topology, journal: Journal, turn: string, identity: {
        application_instance: string;
        activation: string;
    });
    listen(socketPath: string): Promise<void>;
    close(): Promise<void>;
    private serve;
    private handleLine;
    invoke(request: InvokeRequest): InvokeResponse;
    private decide;
}
