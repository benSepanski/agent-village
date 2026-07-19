import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import kleur from 'kleur';

const CRED_PATH = join(homedir(), '.config', 'agent-village', 'credentials');
const SERVICE_NAME = 'agent-village';
const KEYCHAIN_ACCOUNT = 'cognito-refresh';

/** Legacy hosted-UI-domain shape, refreshed via `https://<domain>/oauth2/token`. */
export interface LegacyStoredCredentials {
  refreshToken: string;
  clientId: string;
  domain: string;
}

/** `village login` shape, refreshed via cognito-idp REFRESH_TOKEN_AUTH. */
export interface IdpStoredCredentials {
  kind: 'idp';
  region: string;
  clientId: string;
  refreshToken: string;
}

export type StoredCredentials = LegacyStoredCredentials | IdpStoredCredentials;

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): boolean;
}

let keyringWarned = false;

export async function openKeyring(): Promise<KeyringEntry | null> {
  try {
    const mod = await import('@napi-rs/keyring');
    return new mod.Entry(SERVICE_NAME, KEYCHAIN_ACCOUNT);
  } catch {
    return null;
  }
}

function warnNoKeyring(): void {
  if (keyringWarned) return;
  keyringWarned = true;
  const heading = kleur.red().bold('⚠  SECURITY WARNING');
  const detail = kleur.yellow(
    `OS keychain unavailable — refresh token will be read from plaintext at ${CRED_PATH}. ` +
      'Install a system keyring (libsecret/gnome-keyring on Linux) or set AV_ACCESS_TOKEN ' +
      'to avoid storing secrets on disk.',
  );
  process.stderr.write(`${heading}\n${detail}\n`);
}

function parseIdpCredentials(o: Record<string, unknown>): IdpStoredCredentials {
  if (
    typeof o['region'] === 'string' &&
    typeof o['clientId'] === 'string' &&
    typeof o['refreshToken'] === 'string'
  ) {
    return {
      kind: 'idp',
      region: o['region'],
      clientId: o['clientId'],
      refreshToken: o['refreshToken'],
    };
  }
  throw new Error('malformed idp credentials');
}

function parseLegacyCredentials(o: Record<string, unknown>): LegacyStoredCredentials {
  if (
    typeof o['domain'] === 'string' &&
    typeof o['clientId'] === 'string' &&
    typeof o['refreshToken'] === 'string'
  ) {
    return { refreshToken: o['refreshToken'], clientId: o['clientId'], domain: o['domain'] };
  }
  throw new Error('malformed legacy credentials');
}

/** Tolerant parse: a `kind: 'idp'` field selects the new shape, a `domain` field the legacy one. */
function parseCredentials(raw: string): StoredCredentials {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('malformed credentials JSON');
  }
  const o = parsed as Record<string, unknown>;
  if (o['kind'] === 'idp') return parseIdpCredentials(o);
  if (typeof o['domain'] === 'string') return parseLegacyCredentials(o);
  throw new Error('unrecognized credentials shape');
}

function readEntry(entry: KeyringEntry): StoredCredentials | null | 'backend-error' {
  try {
    const raw = entry.getPassword();
    return raw ? parseCredentials(raw) : null;
  } catch {
    return 'backend-error';
  }
}

async function readFromFile(): Promise<StoredCredentials | null> {
  try {
    const text = await readFile(CRED_PATH, 'utf8');
    return parseCredentials(text);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function tryMigrate(entry: KeyringEntry, creds: StoredCredentials): void {
  try {
    entry.setPassword(JSON.stringify(creds));
  } catch {
    // best-effort; if the backend rejects the write, the next invocation
    // will simply read the file again.
  }
}

async function loadFromKeychain(entry: KeyringEntry): Promise<StoredCredentials | null> {
  const result = readEntry(entry);
  if (result === 'backend-error') {
    warnNoKeyring();
    return readFromFile();
  }
  if (result) return result;
  const fromFile = await readFromFile();
  if (fromFile) tryMigrate(entry, fromFile);
  return fromFile;
}

async function loadCredentials(): Promise<StoredCredentials> {
  const entry = await openKeyring();
  let creds: StoredCredentials | null;
  if (entry) {
    creds = await loadFromKeychain(entry);
  } else {
    warnNoKeyring();
    creds = await readFromFile();
  }
  if (!creds) {
    throw new Error(
      `No stored credentials found. Run \`village login\`, set AV_ACCESS_TOKEN, or write a credentials JSON to ${CRED_PATH}.`,
    );
  }
  return creds;
}

/** Persist credentials to the keychain when available, else the plaintext-fallback file. */
export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  const entry = await openKeyring();
  if (entry) {
    try {
      entry.setPassword(JSON.stringify(creds));
      return;
    } catch {
      // fall through to the file store
    }
  }
  warnNoKeyring();
  await mkdir(dirname(CRED_PATH), { recursive: true, mode: 0o700 });
  await writeFile(CRED_PATH, JSON.stringify(creds), { encoding: 'utf8', mode: 0o600 });
}

/** Delete stored credentials from both the keychain and the plaintext-fallback file, if present. */
export async function clearCredentials(): Promise<void> {
  const entry = await openKeyring();
  if (entry) {
    try {
      entry.deletePassword();
    } catch {
      // nothing stored, or the backend is unavailable — proceed to the file.
    }
  }
  try {
    await unlink(CRED_PATH);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

interface TokenResponse {
  access_token: string;
}

async function refreshLegacy(creds: LegacyStoredCredentials): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: creds.clientId,
    refresh_token: creds.refreshToken,
  });
  const res = await fetch(`https://${creds.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Cognito refresh failed: ${res.status} ${await res.text()}`);
  const tokens = (await res.json()) as TokenResponse;
  return tokens.access_token;
}

interface CognitoAuthResult {
  AuthenticationResult?: { AccessToken: string };
}

async function refreshIdp(creds: IdpStoredCredentials): Promise<string> {
  const res = await fetch(`https://cognito-idp.${creds.region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: creds.clientId,
      AuthParameters: { REFRESH_TOKEN: creds.refreshToken },
    }),
  });
  if (!res.ok) throw new Error(`Cognito refresh failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as CognitoAuthResult;
  const token = body.AuthenticationResult?.AccessToken;
  if (!token) throw new Error('Cognito refresh response missing AccessToken');
  return token;
}

async function exchangeRefreshToken(creds: StoredCredentials): Promise<string> {
  return 'kind' in creds ? refreshIdp(creds) : refreshLegacy(creds);
}

/**
 * Returns a Cognito access token. AV_ACCESS_TOKEN short-circuits the refresh
 * flow — handy for local dev and CI where an interactive sign-in isn't
 * available. Otherwise looks up the stored-credentials blob in the OS
 * keychain (macOS Keychain / Windows Credential Manager / libsecret on
 * Linux); if the keychain is unreachable it warns once and falls back to the
 * legacy file at ~/.config/agent-village/credentials. Successful file reads
 * are silently migrated into the keychain on next-use. The stored blob is
 * either the legacy hosted-UI-domain shape or the `village login` idp shape
 * — see StoredCredentials.
 */
export async function getAccessToken(): Promise<string> {
  const direct = process.env['AV_ACCESS_TOKEN'];
  if (direct) return direct;
  const creds = await loadCredentials();
  return exchangeRefreshToken(creds);
}
