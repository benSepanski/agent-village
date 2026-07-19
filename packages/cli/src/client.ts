import { getAccessToken } from './auth.js';
import { resolveApiUrl } from './config.js';

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string): Promise<T>;
}

interface RequestArgs {
  method: string;
  baseUrl: string;
  token: string;
  path: string;
  body?: unknown;
}

async function request<T>(args: RequestArgs): Promise<T> {
  const init: RequestInit = {
    method: args.method,
    headers: {
      authorization: `Bearer ${args.token}`,
      'content-type': 'application/json',
    },
  };
  if (args.body !== undefined) init.body = JSON.stringify(args.body);
  const res = await fetch(`${args.baseUrl}${args.path}`, init);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${args.method} ${args.path} → ${res.status}: ${text}`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export async function getClient(): Promise<ApiClient> {
  const baseUrl = await resolveApiUrl();
  const token = await getAccessToken();
  return {
    get: <T>(path: string) => request<T>({ method: 'GET', baseUrl, token, path }),
    post: <T>(path: string, body?: unknown) =>
      request<T>({ method: 'POST', baseUrl, token, path, body }),
    patch: <T>(path: string, body?: unknown) =>
      request<T>({ method: 'PATCH', baseUrl, token, path, body }),
    del: <T>(path: string) => request<T>({ method: 'DELETE', baseUrl, token, path }),
  };
}

let override: ApiClient | undefined;
export function setApiClient(c: ApiClient | undefined): void {
  override = c;
}
export async function client(): Promise<ApiClient> {
  return override ?? (await getClient());
}
