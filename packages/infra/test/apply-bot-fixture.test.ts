import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App, Stack } from 'aws-cdk-lib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApplicationManifest, CreateAgentInput } from '@agent-village/shared';
import { EnvConfigSchema, loadEnvConfig } from '../config/index.js';
import { buildApp } from '../src/app-builder.js';

// examples/apply-bot/ — the AC-5.4 dependent-project fixture (see that
// directory's README). Mirrors packages/cli/src/commands/init.test.ts for
// the manifest/agent validity shape, and test/entrypoint.test.ts for the
// sandbox-entrypoint dry-run shape.
const FIXTURE_DIR = fileURLToPath(new URL('../../../examples/apply-bot/', import.meta.url));
const ENV_CONFIG_PATH = path.join(FIXTURE_DIR, 'platform-config', 'apply-bot.env.json');
const ENTRYPOINT = fileURLToPath(new URL('../sandbox-image/entrypoint.sh', import.meta.url));

function readFixtureJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, file), 'utf8'));
}

describe('apply-bot fixture: manifest + agent validity', () => {
  it('manifest.json parses as ApplicationManifest', () => {
    expect(() => ApplicationManifest.parse(readFixtureJson('manifest.json'))).not.toThrow();
  });

  it('agent.json parses as CreateAgentInput', () => {
    expect(() => CreateAgentInput.parse(readFixtureJson('agent.json'))).not.toThrow();
  });
});

describe('apply-bot fixture: config injection end-to-end (AC-5.4)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it(
    'loads the injected apply-bot config and synths apply-bot-* stacks',
    { timeout: 60_000 },
    () => {
      vi.stubEnv('AV_ENV_CONFIG_PATH', ENV_CONFIG_PATH);
      const config = loadEnvConfig('apply-bot');
      expect(config.env).toBe('apply-bot');
      expect(config.prefix).toBe('apply-bot');

      const app = new App();
      buildApp(app, config);
      const stackIds = app.node.children.filter(Stack.isStack).map((stack) => stack.node.id);
      expect(stackIds.sort()).toEqual(
        [
          'apply-bot-api',
          'apply-bot-auth',
          'apply-bot-data',
          'apply-bot-monitoring',
          'apply-bot-runner',
          'apply-bot-sandbox',
          'apply-bot-web',
        ].sort(),
      );
    },
  );

  it('rejects a reserved prefix even for an otherwise-valid injected config', () => {
    const raw = readFixtureJson('platform-config/apply-bot.env.json') as Record<string, unknown>;
    expect(() => EnvConfigSchema.parse({ ...raw, prefix: 'agent-village-dev' })).toThrow(
      /reserved for a first-party deploy/,
    );
  });

  it('rejects a reserved env name (dev/prod) even for an otherwise-valid injected config', () => {
    const raw = readFixtureJson('platform-config/apply-bot.env.json') as Record<string, unknown>;
    expect(() => EnvConfigSchema.parse({ ...raw, env: 'dev' })).toThrow(
      /reserved for the first-party configs/,
    );
  });
});

// Stands in for the AWS CLI: records every invocation and emulates `s3 sync`
// by copying between the fake remote dir and the local workspace dir.
// Mirrors test/entrypoint.test.ts's AWS_STUB exactly.
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

// python3 (3.14) is available locally per the design spec, but not
// guaranteed on every CI runner — gate like entrypoint.test.ts's hasTimeout.
const hasPython3 = spawnSync('python3', ['--version']).status === 0;

describe('apply-bot fixture: sandbox entrypoint dry run', () => {
  it.runIf(hasPython3)(
    'syncs down, runs main.py, writes state under the right workspace layout, syncs up',
    { timeout: 20_000 },
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'av-apply-bot-'));
      const remoteDir = path.join(root, 'remote');
      const workspaceDir = path.join(root, 'workspace');
      const binDir = path.join(root, 'bin');
      const appStagingDir = path.join(root, 'app-staging');
      mkdirSync(path.join(remoteDir, 'apply-bot'), { recursive: true });
      mkdirSync(binDir, { recursive: true });
      cpSync(path.join(FIXTURE_DIR, 'main.py'), path.join(remoteDir, 'apply-bot', 'main.py'));
      const stubPath = path.join(binDir, 'aws');
      writeFileSync(stubPath, AWS_STUB);
      chmodSync(stubPath, 0o755);
      const stubLog = path.join(root, 'aws-calls.log');

      // The fixture's real command hardcodes "/workspace" (the production
      // default, matching examples/gmail-agent's command). Substitute the
      // isolated tmp workspace dir for the test — same script, same shape,
      // just parameterized so the dry run doesn't touch the real filesystem
      // root. Route the /tmp/app staging copy into the tmp root too, so
      // nothing leaks between test runs.
      const manifest = readFixtureJson('manifest.json') as { command: string[] };
      const testCommand = manifest.command.map((part) =>
        part.replaceAll('/workspace', workspaceDir).replaceAll('/tmp/app', appStagingDir),
      );
      expect(testCommand.join(' ')).toContain('python3 main.py');

      const result = spawnSync('bash', [ENTRYPOINT, ...testCommand], {
        env: {
          PATH: `${binDir}:${process.env['PATH'] ?? ''}`,
          AWS_STUB_LOG: stubLog,
          AWS_STUB_REMOTE: remoteDir,
          AV_WORKSPACE_URI: 's3://test-bucket/user-1/agent-1/',
          AV_WORKSPACE_DIR: workspaceDir,
          AV_FLUSH_SECONDS: '0',
        },
        encoding: 'utf8',
      });

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('"event":"sandbox.run.sync_down"');
      expect(result.stdout).toContain('"event":"sandbox.run.sync_up"');
      expect(result.stdout).toContain('apply-bot: run #1');

      // "The right layout": <workspace>/apply-bot/state.json, synced back
      // to the fake remote (S3 stand-in) by the entrypoint's final sync_up.
      const statePath = path.join(remoteDir, 'apply-bot', 'state.json');
      expect(existsSync(statePath)).toBe(true);
      const state: { runCount: number; appliedJobIds: string[] } = JSON.parse(
        readFileSync(statePath, 'utf8'),
      );
      expect(state.runCount).toBe(1);
      // No jobs.json was seeded, so the run is a safe no-op (see main.py /
      // README) rather than a failure.
      expect(state.appliedJobIds).toEqual([]);

      rmSync(appStagingDir, { recursive: true, force: true });
    },
  );
});
