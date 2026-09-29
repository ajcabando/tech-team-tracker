import { useEffect, useState } from 'react';

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

/**
 * Single-flight refresh.
 *
 * The refresh token is single-use: the server revokes it on rotation, so N
 * parallel 401s refreshing the same token would yield N-1 failures. Every
 * caller therefore shares one in-flight refresh, and only a definitive 401/403
 * from the refresh endpoint clears tokens — a 429, 5xx, or network blip must
 * leave the session intact or one rate-limited blip would sign everyone out.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (!refreshToken) return false;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const current = refreshToken;
    if (!current) return false;
    let response: Response;
    try {
      response = await fetch(`${API_BASE}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: current }),
      });
    } catch {
      // Network failure: the session is not provably dead, so leave it alone.
      return false;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) setTokens(null, null);
      return false;
    }
    const data = (await parse(response)) as { accessToken: string; refreshToken: string };
    setTokens(data.accessToken, data.refreshToken);
    return true;
  })();

  try {
    return await refreshInFlight;
  } finally {
    // Cleared only after it settles, so a later expiry can refresh again while
    // concurrent callers still join this one.
    refreshInFlight = null;
  }
}

type Options = { method?: string; body?: unknown; auth?: boolean; retry?: boolean };

export async function api<T>(path: string, options: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const sentToken = options.auth === false ? null : accessToken;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (response.status === 401 && options.auth !== false && options.retry !== false) {
    // If the token on file has changed since this request went out, a concurrent
    // caller already rotated it — retry with that one instead of refreshing again.
    if (accessToken && sentToken && accessToken !== sentToken) return api<T>(path, { ...options, retry: false });
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
  const sentToken = accessToken;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;
  const response = await fetch(`${API_BASE}/api/settings/assets`, { method: 'POST', headers, body: form });
  if (response.status === 401) {
    // Same rule as api(): a token rotated by a concurrent caller needs no refresh.
    if (accessToken && sentToken && accessToken !== sentToken) return uploadAsset(kind, file);
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

/**
 * The release version, read from the server rather than hardcoded. The server
 * gets it from the single VERSION file at the repository root, which is also
 * what the Android build uses for versionName — so the number the dashboard
 * advertises and the number baked into the APK cannot drift apart.
 *
 * Cached for the life of the page: it changes only on deploy, never at runtime.
 */
let versionPromise: Promise<string> | null = null;

export function fetchReleaseVersion(): Promise<string> {
  if (!versionPromise) {
    versionPromise = api<{ version?: string }>('/health/version', { auth: false })
      .then((data) => data.version || '')
      .catch(() => '');
  }
  return versionPromise;
}

/** Prefixed for display, or an empty string while the value is still loading. */
export function useReleaseVersion(): string {
  const [version, setVersion] = useState('');
  useEffect(() => {
    let active = true;
    fetchReleaseVersion().then((value) => {
      if (active) setVersion(value ? `v${value}` : '');
    });
    return () => {
      active = false;
    };
  }, []);
  return version;
}
