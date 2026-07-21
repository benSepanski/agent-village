import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnvConfig } from '../config/index.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('loadEnvConfig', () => {
  it('rejects unknown env names with a prescriptive message', () => {
    expect(() => loadEnvConfig('staging')).toThrow(/--context env=dev or --context env=prod/);
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
});
