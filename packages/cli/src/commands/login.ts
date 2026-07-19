import { saveCredentials } from '../auth.js';
import { loadConfig, saveConfig, type CliConfig } from '../config.js';
import { kv } from '../format.js';
import { promptPassword, promptText } from '../prompt.js';
import {
  initiateUserPasswordAuth,
  respondToMfaChallenge,
  type CognitoAuthResponse,
} from './cognito-idp.js';

export interface LoginPrompter {
  email(): Promise<string>;
  password(): Promise<string>;
  mfaCode(): Promise<string>;
}

const defaultPrompter: LoginPrompter = {
  email: () => promptText('Email: '),
  password: () => promptPassword('Password: '),
  mfaCode: () => promptText('MFA code: '),
};

export interface LoginOptions {
  apiUrl?: string | undefined;
  region?: string | undefined;
  clientId?: string | undefined;
  email?: string | undefined;
  prompter?: LoginPrompter | undefined;
  /** Test seam: overrides the default ~/.config/agent-village/config.json path. */
  configPath?: string | undefined;
}

interface PartialConfig {
  apiUrl: string | undefined;
  region: string | undefined;
  clientId: string | undefined;
}

function missingFlags(config: PartialConfig): string[] {
  return [
    !config.apiUrl && '--api-url',
    !config.region && '--region',
    !config.clientId && '--client-id',
  ].filter((flag): flag is string => Boolean(flag));
}

async function resolveConfig(opts: LoginOptions): Promise<CliConfig> {
  const saved = await loadConfig(opts.configPath);
  const merged: PartialConfig = {
    apiUrl: opts.apiUrl ?? saved?.apiUrl,
    region: opts.region ?? saved?.region,
    clientId: opts.clientId ?? saved?.clientId,
  };
  const missing = missingFlags(merged);
  if (missing.length > 0) {
    throw new Error(
      `Missing required login config: ${missing.join(', ')} (all three are required on first login).`,
    );
  }
  return merged as CliConfig;
}

async function completeChallenge(
  result: CognitoAuthResponse,
  config: CliConfig,
  email: string,
  prompter: LoginPrompter,
): Promise<CognitoAuthResponse> {
  if (result.AuthenticationResult) return result;
  if (result.ChallengeName !== 'SOFTWARE_TOKEN_MFA') {
    throw new Error(
      `Unsupported sign-in challenge "${result.ChallengeName ?? 'unknown'}" — complete it in the web UI first, then try \`village login\` again.`,
    );
  }
  if (!result.Session) throw new Error('Cognito MFA challenge is missing a session token');
  const code = await prompter.mfaCode();
  return respondToMfaChallenge({
    region: config.region,
    clientId: config.clientId,
    email,
    code,
    session: result.Session,
  });
}

/** Sign in via cognito-idp USER_PASSWORD_AUTH, store the refresh token, and persist the CLI config. */
export async function login(opts: LoginOptions = {}): Promise<string> {
  const config = await resolveConfig(opts);
  const prompter = opts.prompter ?? defaultPrompter;
  const email = opts.email ?? (await prompter.email());
  const password = await prompter.password();
  const initial = await initiateUserPasswordAuth({
    region: config.region,
    clientId: config.clientId,
    email,
    password,
  });
  const final = await completeChallenge(initial, config, email, prompter);
  const refreshToken = final.AuthenticationResult?.RefreshToken;
  if (!refreshToken) throw new Error('Cognito sign-in did not return a refresh token');
  await saveCredentials({
    kind: 'idp',
    region: config.region,
    clientId: config.clientId,
    refreshToken,
  });
  await saveConfig(config, opts.configPath);
  return kv([
    ['email', email],
    ['apiUrl', config.apiUrl],
    ['action', 'signed in'],
  ]);
}
