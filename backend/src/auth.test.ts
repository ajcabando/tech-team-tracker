import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from './auth';

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256';
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';

const findFirst = vi.fn();
vi.mock('./db', () => ({ db: { device: { findFirst: (...args: unknown[]) => findFirst(...args) } } }));

type AuthGuard = (req: { headers: Record<string, string> }, res: ReturnType<typeof mockRes>, next: () => void) => void;
let token: (user: AuthUser) => string;
let verifyAccess: (raw: string) => AuthUser;
let hashToken: (raw: string) => string;
// Cast: the express-typed guard is exercised here with minimal mock req/res objects.
let auth: AuthGuard;

beforeAll(async () => {
  const authModule = await import('./auth');
  ({ token, verifyAccess, hashToken } = authModule);
  auth = authModule.auth as unknown as AuthGuard;
});

function mockReq(headers: Record<string, string> = {}) {
  return { headers };
}
function mockRes() {
  const res = {
    statusCode: 200 as number,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

describe('access tokens', () => {
  it('round-trips an administrative identity', () => {
    const issued = token({ id: 'user-1', organizationId: 'org-1', role: 'ADMIN' });
    const decoded = verifyAccess(issued);
    expect(decoded.id).toBe('user-1');
    expect(decoded.organizationId).toBe('org-1');
    expect(decoded.role).toBe('ADMIN');
  });

  it('round-trips a device identity with the device flag', () => {
    const decoded = verifyAccess(token({ id: 'device-1', organizationId: 'org-1', role: 'TECHNICIAN', device: true }));
    expect(decoded.device).toBe(true);
    expect(decoded.role).toBe('TECHNICIAN');
  });

  it('rejects a tampered token', () => {
    const issued = token({ id: 'user-1', role: 'ADMIN' });
    expect(() => verifyAccess(`${issued}x`)).toThrow();
  });
});

describe('refresh token hashing', () => {
  it('is deterministic and never stores the raw token', () => {
    const raw = 'a-very-secret-refresh-token';
    expect(hashToken(raw)).toBe(hashToken(raw));
    expect(hashToken(raw)).not.toContain(raw);
    expect(hashToken(`${raw}!`)).not.toBe(hashToken(raw));
  });
});

describe('administrative auth guard', () => {
  beforeEach(() => findFirst.mockReset());

  it('lets a user session through', () => {
    const req = mockReq({ authorization: `Bearer ${token({ id: 'user-1', role: 'ADMIN' })}` });
    const res = mockRes();
    const next = vi.fn();
    auth(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
  });

  it('rejects a JWT carrying the device flag with 403', () => {
    const req = mockReq({ authorization: `Bearer ${token({ id: 'device-1', role: 'TECHNICIAN', device: true })}` });
    const res = mockRes();
    auth(req, res, vi.fn());
    expect(res.statusCode).toBe(403);
  });

  it('answers 403 for opaque device credentials without probing validity', async () => {
    // Opaque device tokens (paired OR unpaired) are never user sessions. The guard
    // must not look them up either — that would leak credential validity.
    const req = mockReq({ authorization: 'Bearer opaque-device-credential-value' });
    const res = mockRes();
    auth(req, res, vi.fn());
    await vi.waitFor(() => expect(res.statusCode).toBe(403));
    expect(findFirst).not.toHaveBeenCalled();
    expect((res.body as { error: string }).error).toBe('A signed-in user session is required');
  });

  it('keeps unknown opaque garbage at 403 as well, never revealing whether it existed', () => {
    const req = mockReq({ authorization: 'Bearer not-a-real-token' });
    const res = mockRes();
    auth(req, res, vi.fn());
    expect(res.statusCode).toBe(403);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects a tampered user JWT with 401', () => {
    const issued = token({ id: 'user-1', role: 'ADMIN' });
    const req = mockReq({ authorization: `Bearer ${issued}x` });
    const res = mockRes();
    auth(req, res, vi.fn());
    expect(res.statusCode).toBe(401);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('does not hit the database for JWT-shaped garbage', () => {
    const req = mockReq({ authorization: 'Bearer aaa.bbb.ccc' });
    const res = mockRes();
    auth(req, res, vi.fn());
    expect(res.statusCode).toBe(401);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('requires a token', () => {
    const req = mockReq();
    const res = mockRes();
    auth(req, res, vi.fn());
    expect(res.statusCode).toBe(401);
  });
});
