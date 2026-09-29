import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Contract under test:
 *  - N concurrent 401s share ONE /api/auth/refresh network call (single-flight).
 *  - Only a definitive 401/403 from the refresh endpoint clears tokens; a 429,
 *    5xx, or network failure must not destroy the session.
 *  - A request whose token was replaced by a concurrent caller retries with the
 *    new token instead of starting a second refresh.
 */

type FetchCall = { url: string; init: RequestInit };

let fetchCalls: FetchCall[] = [];
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async () => new Response('{}');

// jsdom-less environment: stub the two Storage backends the module resolves from.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  get length(): number {
    return this.map.size;
  }
}

(globalThis as Record<string, unknown>).localStorage = new MemoryStorage();
(globalThis as Record<string, unknown>).sessionStorage = new MemoryStorage();

vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
  fetchCalls.push({ url, init: init ?? {} });
  return fetchImpl(url, init);
});

let api: (typeof import('../lib/api'))['api'];
let setTokens: (access: string | null, refresh: string | null, remembered?: boolean) => void;
let getAccessToken: () => string | null;
let getRefreshToken: () => string | null;

beforeEach(async () => {
  vi.resetModules();
  fetchCalls = [];
  fetchImpl = async () => new Response('{}');
  const module = await import('../lib/api');
  api = module.api as typeof api;
  setTokens = module.setTokens;
  getAccessToken = module.getAccessToken;
  getRefreshToken = module.getRefreshToken;
  setTokens('stale-access-token', 'valid-refresh-token');
  fetchCalls = []; // discard the module-load reads, keep only test-driven calls
});

afterEach(() => {
  setTokens(null, null);
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A fetch impl emulating the API: first call 401s, refreshed calls pass. */
function serverThatRejectsStaleToken(): void {
  fetchImpl = async (url, init) => {
    const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
    if (url.includes('/api/auth/refresh')) {
      // Single-use rotation: the first refresh succeeds, a concurrent repeat fails.
      return jsonResponse(200, { accessToken: 'fresh-access', refreshToken: 'fresh-refresh', rememberMe: false });
    }
    return auth === 'Bearer fresh-access' ? jsonResponse(200, []) : jsonResponse(401, { error: 'expired' });
  };
}

describe('concurrent 401 refresh', () => {
  it('collapses five parallel 401s into exactly one refresh call and all five succeed', async () => {
    serverThatRejectsStaleToken();
    const results = await Promise.all([
      api('/api/devices'),
      api('/api/dashboard/summary'),
      api('/api/trips'),
      api('/api/alerts'),
      api('/api/technicians'),
    ]);
    expect(results).toHaveLength(5);
    const refreshCalls = fetchCalls.filter((call) => call.url.includes('/api/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
    expect(getAccessToken()).toBe('fresh-access');
    expect(getRefreshToken()).toBe('fresh-refresh');
  });

  it('retries the original request with the rotated token', async () => {
    serverThatRejectsStaleToken();
    await api('/api/devices');
    const deviceCalls = fetchCalls.filter((call) => call.url.includes('/api/devices'));
    expect(deviceCalls).toHaveLength(2);
    expect((deviceCalls[1].init.headers as Record<string, string>).Authorization).toBe('Bearer fresh-access');
  });
});

describe('refresh failure handling', () => {
  it('keeps the session on a 429 from the refresh endpoint', async () => {
    fetchImpl = async (url) =>
      url.includes('/api/auth/refresh') ? jsonResponse(429, { error: 'Too many requests' }) : jsonResponse(401, { error: 'expired' });
    await expect(api('/api/devices')).rejects.toMatchObject({ status: 401 });
    expect(getRefreshToken()).toBe('valid-refresh-token');
    expect(getAccessToken()).toBe('stale-access-token');
  });

  it('keeps the session on a 5xx from the refresh endpoint', async () => {
    fetchImpl = async (url) =>
      url.includes('/api/auth/refresh') ? jsonResponse(500, { error: 'boom' }) : jsonResponse(401, { error: 'expired' });
    await expect(api('/api/devices')).rejects.toMatchObject({ status: 401 });
    expect(getRefreshToken()).toBe('valid-refresh-token');
  });

  it('keeps the session when the refresh call throws a network error', async () => {
    fetchImpl = async (url) => {
      if (url.includes('/api/auth/refresh')) throw new TypeError('Failed to fetch');
      return jsonResponse(401, { error: 'expired' });
    };
    await expect(api('/api/devices')).rejects.toMatchObject({ status: 401 });
    expect(getRefreshToken()).toBe('valid-refresh-token');
  });

  it('clears both tokens when the refresh endpoint definitively rejects with 401', async () => {
    fetchImpl = async (url) =>
      url.includes('/api/auth/refresh') ? jsonResponse(401, { error: 'Refresh token is invalid or expired' }) : jsonResponse(401, { error: 'expired' });
    await expect(api('/api/devices')).rejects.toMatchObject({ status: 401 });
    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
  });

  it('can refresh again after a settled failed attempt', async () => {
    let refreshAttempts = 0;
    fetchImpl = async (url, init) => {
      if (url.includes('/api/auth/refresh')) {
        refreshAttempts += 1;
        // First attempt: server briefly unavailable. Second: recovered.
        if (refreshAttempts === 1) return jsonResponse(500, { error: 'briefly down' });
        return jsonResponse(200, { accessToken: 'fresh-access', refreshToken: 'fresh-refresh', rememberMe: false });
      }
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      return auth === 'Bearer fresh-access' ? jsonResponse(200, []) : jsonResponse(401, { error: 'expired' });
    };
    // First request: its refresh fails with 500, the original 401 propagates,
    // and the session survives (asserted above).
    await expect(api('/api/devices')).rejects.toMatchObject({ status: 401 });
    // A later attempt must be able to refresh again — the failed attempt must
    // not have wedged the single-flight promise.
    await api('/api/devices');
    const refreshCalls = fetchCalls.filter((call) => call.url.includes('/api/auth/refresh'));
    expect(refreshCalls.length).toBe(2);
    expect(getAccessToken()).toBe('fresh-access');
  });
});

describe('concurrent callers that lose the race', () => {
  it('retries with a token rotated by another caller instead of refreshing again', async () => {
    // The 401 reaches this caller only after a concurrent request already
    // rotated the pair — it must ride the new token, not start a second refresh
    // (which the single-use server token would reject anyway).
    fetchImpl = async (url, init) => {
      if (url.includes('/api/auth/refresh')) return jsonResponse(200, { accessToken: 'unused', refreshToken: 'unused' });
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      if (auth === 'Bearer fresh-access') return jsonResponse(200, []);
      setTokens('fresh-access', 'fresh-refresh'); // rotation lands before this 401 is handled
      return jsonResponse(401, { error: 'expired' });
    };
    await expect(api('/api/devices')).resolves.toEqual([]);
    const refreshCalls = fetchCalls.filter((call) => call.url.includes('/api/auth/refresh'));
    expect(refreshCalls).toHaveLength(0);
    const deviceCalls = fetchCalls.filter((call) => call.url.includes('/api/devices'));
    expect(deviceCalls).toHaveLength(2);
  });
});

describe('session tier storage', () => {
  it('stores a remembered session in localStorage only', () => {
    setTokens('a', 'b', true);
    expect(localStorage.getItem('tracker.accessToken')).toBe('a');
    expect(localStorage.getItem('tracker.refreshToken')).toBe('b');
    expect(sessionStorage.getItem('tracker.accessToken')).toBeNull();
    expect(sessionStorage.getItem('tracker.refreshToken')).toBeNull();
  });

  it('stores an ordinary session in sessionStorage only', () => {
    setTokens('a', 'b', false);
    expect(sessionStorage.getItem('tracker.accessToken')).toBe('a');
    expect(sessionStorage.getItem('tracker.refreshToken')).toBe('b');
    expect(localStorage.getItem('tracker.accessToken')).toBeNull();
    expect(localStorage.getItem('tracker.refreshToken')).toBeNull();
  });

  it('clears both stores on sign-out regardless of tier', () => {
    setTokens('a', 'b', true);
    setTokens(null, null);
    expect(localStorage.getItem('tracker.refreshToken')).toBeNull();
    expect(sessionStorage.getItem('tracker.refreshToken')).toBeNull();
    setTokens('c', 'd', false);
    setTokens(null, null);
    expect(localStorage.getItem('tracker.refreshToken')).toBeNull();
    expect(sessionStorage.getItem('tracker.refreshToken')).toBeNull();
  });

  it('picks a tab-only session back up when the module is reloaded', async () => {
    setTokens('tab-access', 'tab-refresh', false);
    vi.resetModules();
    const fresh = await import('../lib/api');
    expect(fresh.getAccessToken()).toBe('tab-access');
    expect(fresh.getRefreshToken()).toBe('tab-refresh');
  });

  it('keeps a remembered session in localStorage across a rotation', async () => {
    setTokens('stale-access-token', 'valid-refresh-token', true);
    fetchImpl = async (url, init) => {
      if (url.includes('/api/auth/refresh')) {
        // The server may echo no tier at all — the client must not downgrade on that.
        return jsonResponse(200, { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' });
      }
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
      return auth === 'Bearer fresh-access' ? jsonResponse(200, []) : jsonResponse(401, { error: 'expired' });
    };
    await expect(api('/api/devices')).resolves.toEqual([]);
    expect(localStorage.getItem('tracker.refreshToken')).toBe('fresh-refresh');
    expect(sessionStorage.getItem('tracker.refreshToken')).toBeNull();
    expect(getRefreshToken()).toBe('fresh-refresh');
  });
});
