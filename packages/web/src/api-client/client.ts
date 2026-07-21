import { fetchAuthSession } from '../auth/auth-client.js';
import { apiBaseUrl } from '../auth/amplify-config.js';

async function authHeader(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const token = session.tokens?.idToken?.toString();
    return token ? { authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

interface RequestOptions {
  body?: unknown;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(await authHeader()),
  };
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(`${apiBaseUrl()}${path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) =>
    request<T>('POST', path, body === undefined ? {} : { body }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>('PATCH', path, body === undefined ? {} : { body }),
  del: <T>(path: string) => request<T>('DELETE', path),
};
