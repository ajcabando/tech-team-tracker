import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from './auth';

process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256';
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';

let token: (user: AuthUser) => string;
let verifyAccess: (raw: string) => AuthUser;
let hashToken: (raw: string) => string;

beforeAll(async () => {
  ({ token, verifyAccess, hashToken } = await import('./auth'));
});

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
