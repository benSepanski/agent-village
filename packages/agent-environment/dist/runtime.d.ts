export interface RunningEnvironment {
    container: string;
}
/**
 * Runtime shim over the Docker CLI. The one property M1 exists to prove lives
 * here: `--network none` gives the environment a network namespace with
 * loopback only, which the application cannot modify — denial by namespace,
 * not by filtering (AC-M1.1). The only thing reaching in is the channel
 * directory holding the bridge's Unix socket, and the read-only code mount.
 */
export declare function startEnvironment(opts: {
    name: string;
    channelDir: string;
    codeDir: string;
    entrypoint: string;
}): Promise<RunningEnvironment>;
/** Blocks until the environment's process exits; returns its exit code. */
export declare function waitEnvironment(env: RunningEnvironment): Promise<number>;
export declare function environmentLogs(env: RunningEnvironment): Promise<string>;
export declare function removeEnvironment(env: RunningEnvironment): Promise<void>;
