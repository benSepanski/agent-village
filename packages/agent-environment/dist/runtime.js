import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const IMAGE = 'node:22-alpine';
/**
 * Runtime shim over the Docker CLI. The one property M1 exists to prove lives
 * here: `--network none` gives the environment a network namespace with
 * loopback only, which the application cannot modify — denial by namespace,
 * not by filtering (AC-M1.1). The only thing reaching in is the channel
 * directory holding the bridge's Unix socket, and the read-only code mount.
 */
export async function startEnvironment(opts) {
    const { stdout } = await exec('docker', [
        'run',
        '--detach',
        '--network',
        'none',
        '--name',
        opts.name,
        '--volume',
        `${opts.channelDir}:/bridge`,
        '--volume',
        `${opts.codeDir}:/app:ro`,
        IMAGE,
        'node',
        `/app/${opts.entrypoint}`,
    ]);
    return { container: stdout.trim() };
}
/** Blocks until the environment's process exits; returns its exit code. */
export async function waitEnvironment(env) {
    const { stdout } = await exec('docker', ['wait', env.container]);
    return Number.parseInt(stdout.trim(), 10);
}
export async function environmentLogs(env) {
    const { stdout } = await exec('docker', ['logs', env.container]);
    return stdout;
}
export async function removeEnvironment(env) {
    await exec('docker', ['rm', '--force', env.container]);
}
//# sourceMappingURL=runtime.js.map