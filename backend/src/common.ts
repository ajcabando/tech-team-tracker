import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthedRequest } from './auth';
import { db } from './db';
import { UserRole } from '@prisma/client';

/** Wrap async handlers so rejected promises reach the Express error middleware. */
export function asyncHandler(handler: (req: AuthedRequest, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req as AuthedRequest, res, next)).catch(next);
  };
}

export function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return req.ip;
}

type AuditInput = {
  req: AuthedRequest;
  action: string;
  resource: string;
  resourceId?: string | null;
  result?: string;
  organizationId?: string | null;
};

/**
 * Persist an audit entry. Never pass secrets, passwords, or tokens as `action`
 * or `resourceId`; those values are stored verbatim.
 */
export async function audit({ req, action, resource, resourceId, result = 'SUCCESS', organizationId }: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        userId: req.user?.device ? null : req.user?.id ?? null,
        organizationId: organizationId ?? req.user?.organizationId ?? null,
        action,
        resource,
        resourceId: resourceId ?? null,
        ipAddress: clientIp(req),
        result,
      },
    });
  } catch (error) {
    // Auditing must never break the request path.
    console.error('audit-write-failed', error);
  }
}

/** Organization scope for queries: superadmins see everything, others only their org. */
export function orgScope(user?: { role: UserRole; organizationId?: string }) {
  if (user?.role === UserRole.SUPERADMIN) return {};
  if (!user?.organizationId) return { organizationId: '__none__' };
  return { organizationId: user.organizationId };
}

export function requireOrganization(req: AuthedRequest, res: Response): string | null {
  if (!req.user?.organizationId) {
    res.status(400).json({ error: 'An organization is required for this operation' });
    return null;
  }
  return req.user.organizationId;
}

export function paginate(req: Request): { take: number; skip: number } {
  const take = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
  const skip = Math.max(Number(req.query.offset) || 0, 0);
  return { take, skip };
}
