import type { InvokeResponse } from './bridge.js';
/**
 * The environment side of the harness: the only capability handed to the agent
 * instance. It can invoke request types over the mounted channel socket and
 * nothing else; declared-set enforcement and all recording happen on the
 * platform side (see bridge.ts).
 */
export declare class HarnessClient {
    private readonly socketPath;
    constructor(socketPath: string);
    invoke(requestType: string, payload: unknown): Promise<InvokeResponse>;
}
