import { clearCredentials } from '../auth.js';
import { kv } from '../format.js';

/** Clear stored CLI credentials from the keychain and the plaintext-fallback file. */
export async function logout(): Promise<string> {
  await clearCredentials();
  return kv([['action', 'signed out']]);
}
