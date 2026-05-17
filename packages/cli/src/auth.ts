import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CRED_PATH = join(homedir(), '.config', 'agent-village', 'credentials');

interface StoredCredentials {
  refreshToken: string;
  clientId: string;
  domain: string;
}

async function readStoredCredentials(): Promise<StoredCredentials> {
  const text = await readFile(CRED_PATH, 'utf8');
  return JSON.parse(text) as StoredCredentials;
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
 * available. Otherwise reads ~/.config/agent-village/credentials and
 * exchanges the refresh_token for an access_token via Cognito's OAuth
 * endpoint on every command.
 */
export async function getAccessToken(): Promise<string> {
  const direct = process.env['AV_ACCESS_TOKEN'];
  if (direct) return direct;
  const creds = await readStoredCredentials();
  return exchangeRefreshToken(creds);
}
