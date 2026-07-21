import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnvConfig } from '../config/index.js';
import { devConfig } from '../config/dev.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('loadEnvConfig', () => {
  it('rejects unknown env names with a prescriptive message covering both injection paths', () => {
    expect(() => loadEnvConfig('staging')).toThrow(/--context env=dev or --context env=prod/);
    expect(() => loadEnvConfig('staging')).toThrow(/AV_ENV_CONFIG_PATH/);
  });

  it('rejects an empty/undefined env name', () => {
    expect(() => loadEnvConfig(undefined)).toThrow(/Unknown env/);
    expect(() => loadEnvConfig('')).toThrow(/Unknown env/);
  });

  it('falls back to CDK_DEFAULT_ACCOUNT when no account is pinned', () => {
    vi.stubEnv('CDK_DEFAULT_ACCOUNT', '111111111111');
    expect(loadEnvConfig('dev').account).toBe('111111111111');
  });

  it('prefers the pinned prod account over CDK_DEFAULT_ACCOUNT', async () => {
    vi.stubEnv('AV_PROD_ACCOUNT_ID', '222222222222');
    vi.stubEnv('CDK_DEFAULT_ACCOUNT', '111111111111');
    // prod.ts reads AV_PROD_ACCOUNT_ID at module load, so re-import fresh.
    vi.resetModules();
    const { loadEnvConfig: load } = await import('../config/index.js');
    expect(load('prod').account).toBe('222222222222');
  });

  describe('AV_ENV_CONFIG_PATH injection', () => {
    let dir: string;

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    function writeConfig(overrides: Record<string, unknown> = {}): string {
      dir = mkdtempSync(path.join(tmpdir(), 'av-env-config-'));
      const file = path.join(dir, 'env.json');
      writeFileSync(
        file,
        JSON.stringify({
          ...devConfig,
          env: 'my-app',
          prefix: 'my-app',
          ...overrides,
        }),
      );
      return file;
    }

    it('loads and validates a JSON EnvConfig whose env matches --context env', () => {
      vi.stubEnv('AV_ENV_CONFIG_PATH', writeConfig());
      const config = loadEnvConfig('my-app');
      expect(config.env).toBe('my-app');
      expect(config.prefix).toBe('my-app');
    });

    it('applies the CDK_DEFAULT_ACCOUNT fallback to an injected config too', () => {
      vi.stubEnv('AV_ENV_CONFIG_PATH', writeConfig());
      vi.stubEnv('CDK_DEFAULT_ACCOUNT', '333333333333');
      expect(loadEnvConfig('my-app').account).toBe('333333333333');
    });

    it('throws when --context env does not match the injected config env', () => {
      vi.stubEnv('AV_ENV_CONFIG_PATH', writeConfig({ env: 'other-app' }));
      expect(() => loadEnvConfig('my-app')).toThrow(/env "other-app".*--context env=my-app/s);
    });

    it('throws when AV_ENV_CONFIG_PATH is unset for a non-dev/prod env', () => {
      expect(() => loadEnvConfig('my-app')).toThrow(/AV_ENV_CONFIG_PATH/);
    });

    it('rejects an injected config that reuses a reserved env name', () => {
      // env: 'dev' fails EnvConfigSchema's reserved-env refinement before
      // the env-match check ever runs.
      vi.stubEnv('AV_ENV_CONFIG_PATH', writeConfig({ env: 'dev' }));
      expect(() => loadEnvConfig('injected-dev')).toThrow(/reserved/);
    });

    it('rejects an injected config that reuses a reserved (first-party) prefix', () => {
      vi.stubEnv('AV_ENV_CONFIG_PATH', writeConfig({ prefix: 'agent-village-dev' }));
      expect(() => loadEnvConfig('my-app')).toThrow(/reserved/);
    });

    it('rejects a malformed injected config with a Zod error', () => {
      vi.stubEnv('AV_ENV_CONFIG_PATH', writeConfig({ monthlyBudgetUsd: 0 }));
      expect(() => loadEnvConfig('my-app')).toThrow();
    });
  });
});
