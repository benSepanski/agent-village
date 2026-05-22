import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import kleur from 'kleur';

const CRED_PATH = join(homedir(), '.config', 'agent-village', 'credentials');
const SERVICE_NAME = 'agent-village';
const KEYCHAIN_ACCOUNT = 'cognito-refresh';

interface StoredCredentials {
  refreshToken: string;
  clientId: string;
  domain: string;
}

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
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

function readEntry(entry: KeyringEntry): StoredCredentials | null | 'backend-error' {
  try {
    const raw = entry.getPassword();
    return raw ? (JSON.parse(raw) as StoredCredentials) : null;
  } catch {
    return 'backend-error';
  }
}

async function readFromFile(): Promise<StoredCredentials | null> {
  try {
    const text = await readFile(CRED_PATH, 'utf8');
    return JSON.parse(text) as StoredCredentials;
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
      `No stored credentials found. Set AV_ACCESS_TOKEN or write a credentials JSON to ${CRED_PATH}.`,
    );
  }
  return creds;
}

interface TokenResponse {
  access_token: string;
  id_token?: string;
}

async function exchangeRefreshToken(creds: StoredCredentials): Promise<string> {
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

/**
 * Returns a Cognito access token. AV_ACCESS_TOKEN short-circuits the refresh
 * flow — handy for local dev and CI where the hosted-UI redirect isn't
 * available. Otherwise looks up the refresh-token blob in the OS keychain
 * (macOS Keychain / Windows Credential Manager / libsecret on Linux); if the
 * keychain is unreachable it warns once and falls back to the legacy file at
 * ~/.config/agent-village/credentials. Successful file reads are silently
 * migrated into the keychain on next-use.
 */
export async function getAccessToken(): Promise<string> {
  const direct = process.env['AV_ACCESS_TOKEN'];
  if (direct) return direct;
  const creds = await loadCredentials();
  return exchangeRefreshToken(creds);
}
