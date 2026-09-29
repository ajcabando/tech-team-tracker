import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Pin the tier lengths so the expiry assertions below are deterministic even if
// a developer .env leaks in through dotenv.
process.env.DATABASE_URL ||= 'postgresql://user:pass@localhost:5432/test';
process.env.REMEMBER_ME_DAYS = '1';
process.env.REFRESH_TOKEN_DAYS = '30';

const create = vi.fn();
const findUnique = vi.fn();
const update = vi.fn();
vi.mock('./db', () => ({
  db: {
    refreshToken: {
      create: (...args: unknown[]) => create(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

let issueRefreshToken: (userId: string, rememberMe?: boolean) => Promise<string>;
let rotateRefreshToken: (raw: string) => Promise<{ userId: string; refreshToken: string; rememberMe: boolean } | null>;

beforeAll(async () => {
  const authModule = await import('./auth');
  issueRefreshToken = authModule.issueRefreshToken;
  rotateRefreshToken = authModule.rotateRefreshToken;
});

beforeEach(() => {
  create.mockReset();
  findUnique.mockReset();
  update.mockReset();
});

describe('issueRefreshToken tiers', () => {
  it('issues a remembered token for about a day when rememberMe is true', async () => {
    create.mockResolvedValue({});
    const before = Date.now();
    await issueRefreshToken('user-1', true);
    const data = create.mock.calls[0][0].data;
    expect(data.rememberMe).toBe(true);
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 5_000);
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000);
  });

  it('issues an ordinary token for about 30 days when the tier is omitted', async () => {
    create.mockResolvedValue({});
    const before = Date.now();
    await issueRefreshToken('user-1');
    const data = create.mock.calls[0][0].data;
    expect(data.rememberMe).toBe(false);
    expect(data.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 30 * 24 * 60 * 60 * 1000 - 5_000);
    expect(data.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 30 * 24 * 60 * 60 * 1000);
  });

  it('never persists the raw token, only its hash', async () => {
    create.mockResolvedValue({});
    const raw = await issueRefreshToken('user-1', true);
    expect(create.mock.calls[0][0].data.tokenHash).not.toContain(raw);
    expect(create.mock.calls[0][0].data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('rotateRefreshToken tier propagation', () => {
  it('carries the remembered tier onto the replacement token', async () => {
    create.mockResolvedValue({});
    findUnique.mockResolvedValue({ id: 'row-1', userId: 'user-1', rememberMe: true, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    update.mockResolvedValue({});
    const rotated = await rotateRefreshToken('some-raw-token');
    expect(rotated).not.toBeNull();
    expect(rotated!.rememberMe).toBe(true);
    expect(create.mock.calls[0][0].data.rememberMe).toBe(true);
  });

  it('keeps the original deadline on rotation, so a remembered session is capped at 1 day from sign-in', async () => {
    create.mockResolvedValue({});
    const originalExpiry = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6h left of the day
    findUnique.mockResolvedValue({ id: 'row-1', userId: 'user-1', rememberMe: true, revokedAt: null, expiresAt: originalExpiry });
    update.mockResolvedValue({});
    await rotateRefreshToken('some-raw-token');
    // Renewing must not push the deadline out, or an active tab would stay
    // signed in forever and "1 day" would mean "1 day per refresh".
    expect(create.mock.calls[0][0].data.expiresAt.getTime()).toBe(originalExpiry.getTime());
  });

  it('carries the ordinary tier onto the replacement token with a fresh window', async () => {
    create.mockResolvedValue({});
    findUnique.mockResolvedValue({ id: 'row-1', userId: 'user-1', rememberMe: false, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    update.mockResolvedValue({});
    const rotated = await rotateRefreshToken('some-raw-token');
    expect(rotated).not.toBeNull();
    expect(rotated!.rememberMe).toBe(false);
    expect(create.mock.calls[0][0].data.rememberMe).toBe(false);
    // Ordinary sessions keep today's sliding behaviour: a full window from rotation.
    expect(create.mock.calls[0][0].data.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  });

  it('revokes the old row before issuing the replacement', async () => {
    create.mockResolvedValue({});
    findUnique.mockResolvedValue({ id: 'row-1', userId: 'user-1', rememberMe: true, revokedAt: null, expiresAt: new Date(Date.now() + 60_000) });
    update.mockResolvedValue({});
    await rotateRefreshToken('some-raw-token');
    expect(update).toHaveBeenCalledWith({ where: { id: 'row-1' }, data: { revokedAt: expect.any(Date) } });
  });

  it('returns null for an already-revoked token', async () => {
    findUnique.mockResolvedValue({ id: 'row-1', userId: 'user-1', rememberMe: true, revokedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    expect(await rotateRefreshToken('some-raw-token')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('returns null for an expired token', async () => {
    findUnique.mockResolvedValue({ id: 'row-1', userId: 'user-1', rememberMe: false, revokedAt: null, expiresAt: new Date(Date.now() - 60_000) });
    expect(await rotateRefreshToken('some-raw-token')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });

  it('returns null for an unknown token', async () => {
    findUnique.mockResolvedValue(null);
    expect(await rotateRefreshToken('no-such-token')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
