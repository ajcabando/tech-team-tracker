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

export async function issueRefreshToken(userId: string): Promise<string> {
  const raw = randomToken();
  const expiresAt = new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000);
  await db.refreshToken.create({ data: { userId, tokenHash: hashToken(raw), expiresAt } });
  return raw;
}

export async function rotateRefreshToken(raw: string): Promise<{ userId: string; refreshToken: string } | null> {
  const stored = await db.refreshToken.findUnique({ where: { tokenHash: hashToken(raw) } });
  if (!stored || stored.revokedAt || stored.expiresAt.getTime() < Date.now()) return null;
  await db.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  return { userId: stored.userId, refreshToken: await issueRefreshToken(stored.userId) };
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
    return res.status(401).json({ error: 'Invalid or expired token' });
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
