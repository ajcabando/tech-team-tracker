import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { db } from '../db';
import { auth, roles, AuthedRequest } from '../auth';
import { asyncHandler, audit, orgScope, paginate } from '../common';
import { getRetention } from '../services/settings';

export const auditRouter = Router();

auditRouter.get('/api/audit-logs', auth, roles(UserRole.SUPERADMIN, UserRole.ADMIN), asyncHandler(async (req: AuthedRequest, res) => {
  const { take, skip } = paginate(req);
  res.json(
    await db.auditLog.findMany({
      where: {
        ...(req.user?.role === UserRole.SUPERADMIN ? {} : { organizationId: req.user?.organizationId }),
        ...(typeof req.query.action === 'string' ? { action: req.query.action } : {}),
      },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
  );
}));

/**
 * Apply retention windows. Intended to be scheduled (cron/systemd timer).
 * Deletes only data older than the organization's configured retention period.
 */
auditRouter.post('/api/maintenance/retention', auth, roles(UserRole.SUPERADMIN, UserRole.ADMIN), asyncHandler(async (req: AuthedRequest, res) => {
  const organizationId = req.user?.organizationId;
  if (!organizationId) return res.status(400).json({ error: 'Organization required' });
  const retention = await getRetention(organizationId);
  const now = Date.now();
  const days = (value: number) => new Date(now - value * 24 * 60 * 60 * 1000);

  const [locations, auditLogs] = await Promise.all([
    db.location.deleteMany({ where: { organizationId, recordedAt: { lt: days(retention.rawLocationDays) } } }),
    db.auditLog.deleteMany({ where: { organizationId, createdAt: { lt: days(retention.auditLogDays) } } }),
  ]);
  const trips = await db.trip.deleteMany({ where: { organizationId, startedAt: { lt: days(retention.tripDays) } } });

  await audit({ req, action: 'maintenance.retention', resource: 'System', result: 'SUCCESS', organizationId });
  res.json({ deletedLocations: locations.count, deletedTrips: trips.count, deletedAuditLogs: auditLogs.count, retention });
}));

auditRouter.get('/api/organizations/me', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const organization = await db.organization.findFirst({ where: { id: req.user?.organizationId ?? '__none__' }, include: { branding: true, tracking: true, retention: true } });
  if (!organization) return res.status(404).json({ error: 'Organization not found' });
  res.json(organization);
}));
