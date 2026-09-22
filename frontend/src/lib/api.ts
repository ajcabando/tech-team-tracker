export type ApiError = {
  status: number;
  message: string;
  issues?: unknown;
  /** Full response body, so callers can read extra fields (e.g. `history` on a 409). */
  payload?: Record<string, unknown>;
};

export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) || '').replace(/\/$/, '');

const ACCESS_KEY = 'tracker.accessToken';
const REFRESH_KEY = 'tracker.refreshToken';

let accessToken = localStorage.getItem(ACCESS_KEY);
let refreshToken = localStorage.getItem(REFRESH_KEY);

type Listener = () => void;
const listeners = new Set<Listener>();

export function onAuthChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function emit() {
  for (const listener of listeners) listener();
}

export function setTokens(access: string | null, refresh: string | null): void {
  accessToken = access;
  refreshToken = refresh;
  if (access) localStorage.setItem(ACCESS_KEY, access);
  else localStorage.removeItem(ACCESS_KEY);
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  else localStorage.removeItem(REFRESH_KEY);
  emit();
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function refreshSession(): Promise<boolean> {
  if (!refreshToken) return false;
  const response = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    setTokens(null, null);
    return false;
  }
  const data = (await parse(response)) as { accessToken: string; refreshToken: string };
  setTokens(data.accessToken, data.refreshToken);
  return true;
}

type Options = { method?: string; body?: unknown; auth?: boolean; retry?: boolean };

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.auth !== false && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401 && options.auth !== false && options.retry !== false) {
    if (await refreshSession()) return api<T>(path, { ...options, retry: false });
  }
  if (!response.ok) {
    const payload = (await parse(response)) as { error?: string; issues?: unknown } | null;
    const error: ApiError = {
      status: response.status,
      message: (payload && typeof payload === 'object' && payload.error) || `Request failed (${response.status})`,
      issues: payload && typeof payload === 'object' ? payload.issues : undefined,
      payload: payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined,
    };
    throw error;
  }
  return (await parse(response)) as T;
}

/** Upload a file asset (logo or login background) and return the updated Branding. */
export async function uploadAsset(kind: 'logo' | 'background', file: File): Promise<unknown> {
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file);
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${API_BASE}/api/settings/assets`, { method: 'POST', headers, body: form });
  if (response.status === 401) {
    if (await refreshSession()) return uploadAsset(kind, file);
  }
  if (!response.ok) {
    const payload = (await parse(response)) as { error?: string } | null;
    throw { status: response.status, message: payload?.error || `Upload failed (${response.status})` };
  }
  return parse(response);
}

/** Open a server-sent events stream. EventSource cannot send headers, so the token goes in the query. */
export function openStream(path: string, handlers: Record<string, (payload: unknown) => void>): EventSource {
  const url = `${API_BASE}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(accessToken || '')}`;
  const source = new EventSource(url);
  for (const [type, handler] of Object.entries(handlers)) {
    source.addEventListener(type, (event) => {
      try {
        handler(JSON.parse((event as MessageEvent).data));
      } catch {
        /* ignore malformed frames */
      }
    });
  }
  return source;
}
