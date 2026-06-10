import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

const ENTRYPOINT = fileURLToPath(new URL('../sandbox-image/entrypoint.sh', import.meta.url));

// Stands in for the AWS CLI: records every invocation and emulates `s3 sync`
// by copying between the fake remote dir and the local workspace dir.
const AWS_STUB = `#!/usr/bin/env bash
set -e
echo "$*" >> "$AWS_STUB_LOG"
if [ "$1" = "s3" ] && [ "$2" = "sync" ]; then
  resolve() { case "$1" in s3://*) printf '%s' "$AWS_STUB_REMOTE";; *) printf '%s' "$1";; esac; }
  src="$(resolve "$3")"
  dst="$(resolve "$4")"
  mkdir -p "$dst"
  cp -R "$src/." "$dst/"
fi
`;

interface Fixture {
  remoteDir: string;
  workspaceDir: string;
  stubLog: string;
  env: NodeJS.ProcessEnv;
}

let fixture: Fixture;

beforeEach(() => {
  const root = mkdtempSync(path.join(tmpdir(), 'av-entrypoint-'));
  const remoteDir = path.join(root, 'remote');
  const binDir = path.join(root, 'bin');
  mkdirSync(remoteDir);
  mkdirSync(binDir);
  writeFileSync(path.join(remoteDir, 'memory.md'), 'remembered\n');
  const stubPath = path.join(binDir, 'aws');
  writeFileSync(stubPath, AWS_STUB);
  chmodSync(stubPath, 0o755);
  const stubLog = path.join(root, 'aws-calls.log');
  fixture = {
    remoteDir,
    workspaceDir: path.join(root, 'workspace'),
    stubLog,
    env: {
      PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
      AWS_STUB_LOG: stubLog,
      AWS_STUB_REMOTE: remoteDir,
      AV_WORKSPACE_URI: 's3://test-bucket/user-1/agent-1/',
      AV_WORKSPACE_DIR: path.join(root, 'workspace'),
      AV_FLUSH_SECONDS: '0',
    },
  };
});

function runEntrypoint(
  appCommand: string[],
  env: NodeJS.ProcessEnv = {},
): SpawnSyncReturns<string> {
  return spawnSync('bash', [ENTRYPOINT, ...appCommand], {
    env: { ...fixture.env, ...env },
    encoding: 'utf8',
  });
}

function stubCalls(): string[] {
  return existsSync(fixture.stubLog)
    ? readFileSync(fixture.stubLog, 'utf8').trim().split('\n')
    : [];
}

describe('sandbox entrypoint', () => {
  it('syncs down before the app runs and syncs the result back up', () => {
    const result = runEntrypoint([
      'bash',
      '-c',
      'cp "$AV_WORKSPACE_DIR/memory.md" "$AV_WORKSPACE_DIR/copy.md"',
    ]);
    expect(result.status).toBe(0);
    expect(readFileSync(path.join(fixture.remoteDir, 'copy.md'), 'utf8')).toBe('remembered\n');
    const calls = stubCalls();
    expect(calls[0]).toContain(`s3 sync s3://test-bucket/user-1/agent-1/ ${fixture.workspaceDir}`);
    expect(calls.at(-1)).toContain(
      `s3 sync ${fixture.workspaceDir} s3://test-bucket/user-1/agent-1/ --delete`,
    );
    expect(result.stdout).toContain('"event":"sandbox.run.sync_down"');
    expect(result.stdout).toContain('"event":"sandbox.run.sync_up"');
  });

  it('still syncs up and propagates the exit code when the app fails', () => {
    const result = runEntrypoint(['bash', '-c', 'echo wip > "$AV_WORKSPACE_DIR/wip.txt"; exit 7']);
    expect(result.status).toBe(7);
    expect(existsSync(path.join(fixture.remoteDir, 'wip.txt'))).toBe(true);
    expect(result.stdout).toContain('"event":"sandbox.run.app_exited"');
    expect(result.stdout).toContain('"exitCode":7');
  });

  it('flushes the workspace periodically while the app runs', { timeout: 15_000 }, () => {
    const result = runEntrypoint(
      ['bash', '-c', 'echo wip > "$AV_WORKSPACE_DIR/wip.txt"; sleep 2.5'],
      { AV_FLUSH_SECONDS: '1' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"event":"sandbox.run.flush"');
    const upSyncs = stubCalls().filter((call) =>
      call.startsWith(`s3 sync ${fixture.workspaceDir}`),
    );
    expect(upSyncs.length).toBeGreaterThanOrEqual(2);
  });

  it('fails fast when AV_WORKSPACE_URI is missing', () => {
    const { AV_WORKSPACE_URI: _omitted, ...env } = fixture.env;
    const result = spawnSync('bash', [ENTRYPOINT, 'true'], { env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(stubCalls()).toHaveLength(0);
  });
});
