import { describe, expect, it } from 'vitest';
import { EnvConfigSchema, FIRST_PARTY_ENVS, RESERVED_PREFIXES } from './schema.js';
import { devConfig } from './dev.js';

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...devConfig, env: 'my-app', prefix: 'my-app', ...overrides };
}

describe('EnvConfigSchema', () => {
  it('accepts a well-formed injected config', () => {
    expect(EnvConfigSchema.parse(baseConfig())).toMatchObject({ env: 'my-app', prefix: 'my-app' });
  });

  it('accepts a config with no optional fields set', () => {
    const config = baseConfig();
    for (const key of [
      'webDomain',
      'sesSenderDomain',
      'googleClientId',
      'oauthCallbackUrls',
      'account',
    ]) {
      delete config[key];
    }
    expect(() => EnvConfigSchema.parse(config)).not.toThrow();
  });

  describe('env', () => {
    it.each(FIRST_PARTY_ENVS)('rejects reserved env "%s"', (env) => {
      expect(() => EnvConfigSchema.parse(baseConfig({ env }))).toThrow(/reserved/);
    });

    it('rejects an empty env', () => {
      expect(() => EnvConfigSchema.parse(baseConfig({ env: '' }))).toThrow();
    });
  });

  describe('prefix', () => {
    it.each(RESERVED_PREFIXES)('rejects reserved prefix "%s"', (prefix) => {
      expect(() => EnvConfigSchema.parse(baseConfig({ prefix }))).toThrow(/reserved/);
    });

    it('rejects an uppercase prefix', () => {
      expect(() => EnvConfigSchema.parse(baseConfig({ prefix: 'My-App' }))).toThrow();
    });

    it('rejects a prefix starting with a digit or hyphen', () => {
      expect(() => EnvConfigSchema.parse(baseConfig({ prefix: '1app' }))).toThrow();
      expect(() => EnvConfigSchema.parse(baseConfig({ prefix: '-app' }))).toThrow();
    });

    it('rejects a prefix with characters invalid for S3 bucket names', () => {
      expect(() => EnvConfigSchema.parse(baseConfig({ prefix: 'my_app' }))).toThrow();
      expect(() => EnvConfigSchema.parse(baseConfig({ prefix: 'my.app' }))).toThrow();
    });

    it('rejects an overlong prefix', () => {
      expect(() => EnvConfigSchema.parse(baseConfig({ prefix: 'a'.repeat(41) }))).toThrow();
    });

    it('accepts a valid kebab-case prefix', () => {
      expect(() => EnvConfigSchema.parse(baseConfig({ prefix: 'apply-bot' }))).not.toThrow();
    });
  });

  describe('numeric bounds', () => {
    it('rejects monthlyBudgetUsd below 1', () => {
      expect(() => EnvConfigSchema.parse(baseConfig({ monthlyBudgetUsd: 0.5 }))).toThrow();
    });

    it('rejects a non-positive budgetDriftThresholdUsd', () => {
      expect(() => EnvConfigSchema.parse(baseConfig({ budgetDriftThresholdUsd: 0 }))).toThrow();
    });

    it('rejects a non-positive runnerMemoryMb', () => {
      expect(() => EnvConfigSchema.parse(baseConfig({ runnerMemoryMb: 0 }))).toThrow();
    });
  });

  it('rejects a malformed alarmEmail', () => {
    expect(() => EnvConfigSchema.parse(baseConfig({ alarmEmail: 'not-an-email' }))).toThrow();
  });

  it('rejects an unknown field instead of silently stripping it', () => {
    // A misspelled optional field (e.g. `sesSenderDomain` typo'd) must fail
    // loudly rather than silently disabling the feature it configures.
    expect(() => EnvConfigSchema.parse(baseConfig({ sesSenderDoman: 'mail.example.com' }))).toThrow(
      /unrecognized/i,
    );
  });

  it('accepts optional fields when present', () => {
    const config = EnvConfigSchema.parse(
      baseConfig({
        webDomain: 'app.example.com',
        sesSenderDomain: 'mail.example.com',
        googleClientId: 'client-id.apps.googleusercontent.com',
        oauthCallbackUrls: ['https://app.example.com'],
        account: '123456789012',
      }),
    );
    expect(config.oauthCallbackUrls).toEqual(['https://app.example.com']);
  });
});
