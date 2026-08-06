import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { MountRequest } from './runtime.js';
import type { EnvironmentDecl, VolumeDecl } from './topology.js';

/**
 * Host-directory volume storage. The runtime interface leaves storage to the
 * implementation, and one host directory per volume, bind-mounted per
 * declaration, is the Docker shape. The store also owns the two content
 * operations the audit surface needs: a stable content digest — the volume's
 * version on volume events — and session reset, which is destroy-and-recreate
 * after digesting rather than an in-place cleanup.
 */
export class VolumeStore {
  constructor(
    private readonly root: string,
    private readonly volumes: VolumeDecl[],
  ) {
    for (const volume of volumes) {
      mkdirSync(join(root, volume.name), { recursive: true });
    }
  }

  /**
   * Host path backing a mount of `subtree` ("/" is the volume root). Created
   * if absent, so a declared mount of a not-yet-written subtree still binds —
   * an empty directory, not a failed start.
   */
  hostPath(volume: string, subtree: string): string {
    const dir = this.volumeRoot(volume);
    const path = subtree === '/' ? dir : join(dir, ...subtree.split('/'));
    mkdirSync(path, { recursive: true });
    return path;
  }

  volumeRoot(volume: string): string {
    if (!this.volumes.some((v) => v.name === volume)) {
      throw new Error(`volume ${volume} is not declared in this store`);
    }
    return join(this.root, volume);
  }

  /**
   * Content digest over every file under the volume root: sha256 of the
   * sorted (relative path, file digest) pairs. Two volumes with identical
   * file trees digest identically; an empty volume has a well-defined digest.
   */
  digest(volume: string): string {
    const root = this.volumeRoot(volume);
    const files: string[] = [];
    walk(root, '', files);
    files.sort();
    const hash = createHash('sha256');
    for (const relative of files) {
      const fileHash = createHash('sha256')
        .update(readFileSync(join(root, ...relative.split('/'))))
        .digest('hex');
      hash.update(`${relative}\0${fileHash}\n`);
    }
    return `sha256:${hash.digest('hex')}`;
  }

  /**
   * Destroys and recreates a `session` volume's contents at its flow boundary,
   * returning the pre-reset digest that `volume.reset` must carry (AC-M3.2).
   */
  resetSession(volume: string): string {
    const decl = this.volumes.find((v) => v.name === volume);
    if (decl?.durability !== 'session') {
      throw new Error(
        `volume ${volume} is not a session volume; only session contents reset at a flow boundary`,
      );
    }
    const preReset = this.digest(volume);
    const root = this.volumeRoot(volume);
    for (const entry of readdirSync(root)) {
      rmSync(join(root, entry), { recursive: true, force: true });
    }
    return preReset;
  }

  sessionVolumes(): string[] {
    return this.volumes.filter((v) => v.durability === 'session').map((v) => v.name);
  }

  volumeNames(): string[] {
    return this.volumes.map((v) => v.name);
  }
}

function walk(root: string, prefix: string, files: string[]): void {
  const dir = prefix === '' ? root : join(root, ...prefix.split('/'));
  for (const entry of readdirSync(dir).sort()) {
    const relative = prefix === '' ? entry : `${prefix}/${entry}`;
    if (statSync(join(dir, entry)).isDirectory()) {
      walk(root, relative, files);
    } else {
      files.push(relative);
    }
  }
}

/**
 * The runtime request for exactly the declared mount set — the normal start
 * path, exact by construction. The hostile path (a request the declaration
 * does not name) is what `planMounts` exists to refuse.
 */
export function mountRequestsFor(environment: EnvironmentDecl, store: VolumeStore): MountRequest[] {
  return environment.mounts.map((mount) => {
    if (mount.subtree === null) {
      throw new Error(
        `mount of ${mount.volume} into ${environment.name} has no subtree; the checker refuses this before any start`,
      );
    }
    return {
      volume: mount.volume,
      role: mount.role,
      mode: mount.mode,
      subtree: mount.subtree,
      host_path: store.hostPath(mount.volume, mount.subtree),
    };
  });
}
