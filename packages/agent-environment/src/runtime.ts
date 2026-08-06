import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { EnvironmentDecl } from './topology.js';

const exec = promisify(execFile);

const IMAGE = 'node:22-alpine';

export interface RunningEnvironment {
  container: string;
}

/** One requested volume binding: the declared mount plus the host directory backing it. */
export interface MountRequest {
  volume: string;
  role: 'writer' | 'reader';
  mode: 'read-write' | 'read-only';
  subtree: string;
  host_path: string;
}

interface PlannedMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

/** Where a declared mount appears inside the environment's filesystem. */
export function containerPathFor(volume: string): string {
  return `/volumes/${volume}`;
}

export class UndeclaredMountError extends Error {
  constructor(environment: string, detail: string) {
    super(`environment ${environment}: ${detail}`);
    this.name = 'UndeclaredMountError';
  }
}

/**
 * The runtime mounts exactly the declared volumes, at exactly the declared
 * subtrees and modes (spec 0002, runtime interface): a requested binding must
 * match a declared mount on every declared field, and anything else refuses
 * the start before a container exists (AC-M3.1). Read-only is the mount flag,
 * not file permissions, so a zero-writer volume is immutable at the kernel
 * boundary (AC-M3.4).
 */
export function planMounts(environment: EnvironmentDecl, requests: MountRequest[]): PlannedMount[] {
  const mounted = new Set<string>();
  return requests.map((request) => {
    const declared = environment.mounts.some(
      (m) =>
        m.volume === request.volume &&
        m.role === request.role &&
        m.mode === request.mode &&
        m.subtree === request.subtree,
    );
    if (!declared) {
      throw new UndeclaredMountError(
        environment.name,
        `mount request for volume ${request.volume} (role ${request.role}, mode ${request.mode}, subtree ${request.subtree}) matches no declared mount`,
      );
    }
    if (mounted.has(request.volume)) {
      throw new UndeclaredMountError(
        environment.name,
        `volume ${request.volume} is requested twice; a volume mounts at most once per environment`,
      );
    }
    mounted.add(request.volume);
    return {
      hostPath: request.host_path,
      containerPath: containerPathFor(request.volume),
      readOnly: request.mode === 'read-only',
    };
  });
}

/**
 * Runtime shim over the Docker CLI. The no-raw-network property lives here:
 * `--network none` gives the environment a network namespace with loopback
 * only, which the application cannot modify (AC-M1.1). The only things
 * reaching in are the declared volume mounts, the optional channel directory
 * holding a bridge's Unix socket, and the read-only code mount.
 */
export async function startEnvironment(opts: {
  name: string;
  environment: EnvironmentDecl;
  mounts: MountRequest[];
  codeDir: string;
  entrypoint: string;
  args?: string[];
  channelDir?: string;
}): Promise<RunningEnvironment> {
  const planned = planMounts(opts.environment, opts.mounts);
  const channelArgs =
    opts.channelDir === undefined ? [] : ['--volume', `${opts.channelDir}:/bridge`];
  const volumeArgs = planned.flatMap((m) => [
    '--volume',
    `${m.hostPath}:${m.containerPath}${m.readOnly ? ':ro' : ''}`,
  ]);
  const { stdout } = await exec('docker', [
    'run',
    '--detach',
    '--network',
    'none',
    '--name',
    opts.name,
    ...channelArgs,
    '--volume',
    `${opts.codeDir}:/app:ro`,
    ...volumeArgs,
    IMAGE,
    'node',
    `/app/${opts.entrypoint}`,
    ...(opts.args ?? []),
  ]);
  return { container: stdout.trim() };
}

/**
 * The logical compute unit this runtime schedules onto: the Docker daemon's
 * identity. One daemon is one unit, so co-location within an activation is
 * structural here — asserted and journaled anyway (AC-M3.3), so a runtime
 * that schedules across hosts inherits the requirement rather than the
 * accident.
 */
export async function computeUnit(): Promise<string> {
  const { stdout } = await exec('docker', ['info', '--format', '{{.ID}}']);
  return stdout.trim();
}

/** Asserts the container is resident on this runtime's daemon, then names that daemon as its compute unit. */
export async function computeUnitOf(env: RunningEnvironment): Promise<string> {
  await exec('docker', ['inspect', '--format', '{{.Id}}', env.container]);
  return computeUnit();
}

/** True if a container with exactly this name exists in any state — how a refused start is shown to have started nothing. */
export async function environmentExists(name: string): Promise<boolean> {
  const { stdout } = await exec('docker', [
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `name=^/${name}$`,
  ]);
  return stdout.trim().length > 0;
}

/** Blocks until the environment's process exits; returns its exit code. */
export async function waitEnvironment(env: RunningEnvironment): Promise<number> {
  const { stdout } = await exec('docker', ['wait', env.container]);
  return Number.parseInt(stdout.trim(), 10);
}

export async function environmentLogs(env: RunningEnvironment): Promise<string> {
  const { stdout } = await exec('docker', ['logs', env.container]);
  return stdout;
}

export async function removeEnvironment(env: RunningEnvironment): Promise<void> {
  await exec('docker', ['rm', '--force', env.container]);
}
