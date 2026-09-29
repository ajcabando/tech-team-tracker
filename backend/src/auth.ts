import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { UserRole } from '@prisma/client';
import { config } from './config';
import { db } from './db';

export type AuthUser = {
  id: string;
  organizationId?: string;
  role: UserRole;
  /** Device tokens carry the device id in `id` and are NOT user accounts. */
  device?: boolean;
};

export type AuthedRequest = Request & { user?: AuthUser };

export function token(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: config.accessTokenTtl as jwt.SignOptions['expiresIn'] });
}

export function verifyAccess(raw: string): AuthUser {
  return jwt.verify(raw, config.jwtSecret) as AuthUser;
}

/** Long-lived device credential: random opaque token stored hashed, not a JWT. */
export function createDeviceCredential(): { raw: string; hash: string } {
  const raw = randomToken(32);
  const hash = hashToken(raw);
  return { raw, hash };
}

export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function randomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Issues a refresh token for one session tier.
 *
 * `rememberMe` is the "sign in for a day" tier: its expiry is a hard cap counted
 * from the original login (`expiresAt` passed in by the caller on rotation), not
 * from the last refresh, so an active tab cannot keep a remembered session alive
 * indefinitely. Without it the ordinary REFRESH_TOKEN_DAYS applies, unchanged.
 */
export async function issueRefreshToken(userId: string, rememberMe = false, expiresAt?: Date): Promise<string> {
  const raw = randomToken();
  const lifetime = rememberMe ? config.rememberMeDays * 24 * 60 * 60 * 1000 : config.refreshTokenDays * 24 * 60 * 60 * 1000;
  const expiry = expiresAt ?? new Date(Date.now() + lifetime);
  await db.refreshToken.create({ data: { userId, tokenHash: hashToken(raw), expiresAt: expiry, rememberMe } });
  return raw;
}

export async function rotateRefreshToken(raw: string): Promise<{ userId: string; refreshToken: string; rememberMe: boolean } | null> {
  const stored = await db.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) return null;
  // Claim the row with a guarded UPDATE rather than a plain one: two rotations
  // racing on the same token serialize on the row lock, and only the winner sees
  // revokedAt IS NULL — so "single-use" holds under real concurrency, not just
  // when the requests happen to be processed one after the other.
  const claimed = await db.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count === 0) return null;
  // The replacement inherits the tier, and a remembered one inherits the original
  // deadline too — otherwise the 1-day cap would silently renew on every refresh.
  const expiresAt = stored.rememberMe ? stored.expiresAt : undefined;
  return {
    userId: stored.userId,
    refreshToken: await issueRefreshToken(stored.userId, stored.rememberMe, expiresAt),
    rememberMe: stored.rememberMe,
  };
}

/**
 * Administrative session guard. Device (technician) tokens are rejected so a phone
 * credential can never reach management endpoints such as technician or user lists.
 */
export function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const raw = req.headers.authorization?.replace('Bearer ', '');
  if (!raw) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = verifyAccess(raw);
  } catch {
    // JWT-shaped input that failed verification is a bad or expired user session.
    // Anything else is not a user credential at all — device credentials are opaque
    // strings — so answer 403 without probing whether it once was a real token
    // (probing would leak credential validity to whoever holds a guess).
    if (raw.split('.').length === 3) return res.status(401).json({ error: 'Invalid or expired token' });
    return res.status(403).json({ error: 'A signed-in user session is required' });
  }
  if (req.user.device) return res.status(403).json({ error: 'A signed-in user session is required' });
  next();
}

/** Device (technician phone) guard used by the GPS ingestion endpoint. */
export function deviceAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const raw = req.headers.authorization?.replace('Bearer ', '');
  if (!raw) return res.status(401).json({ error: 'Device authentication required' });
  try {
    req.user = verifyAccess(raw);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired device token' });
  }
  if (!req.user.device) return res.status(403).json({ error: 'This endpoint requires a paired device token' });
  next();
}

/** Durable device auth: verifies opaque hashed token against database, not JWT expiry. */
export function durableDeviceAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const raw = req.headers.authorization?.replace('Bearer ', '');
  if (!raw) return res.status(401).json({ error: 'Device authentication required' });
  const hash = hashToken(raw);
  db.device.findFirst({ where: { credentialHash: hash, status: 'ACTIVE' } }).then((device) => {
    if (!device) return res.status(401).json({ error: 'Invalid or revoked device token' });
    req.user = { id: device.id, organizationId: device.organizationId, role: 'TECHNICIAN' as any, device: true };
    next();
  }).catch(() => res.status(500).json({ error: 'Device auth failed' }));
}

/** Kept for readability at call sites where an administrative session is required. */
export function userOnly(_req: AuthedRequest, _res: Response, next: NextFunction) {
  next();
}

export function roles(...allowed: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !allowed.includes(req.user.role)) return res.status(403).json({ error: 'Insufficient permissions' });
    next();
  };
}
