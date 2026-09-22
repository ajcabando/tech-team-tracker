import { Router } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { db } from '../db';
import { auth, roles, AuthedRequest } from '../auth';
import { asyncHandler, audit, paginate } from '../common';
import { ensureOrganizationSettings } from '../services/settings';

export const organizationsRouter = Router();

// Guard each route individually: a router-level `use()` would also run for unrelated
// requests because this router is mounted at the application root.
const superadminOnly = [auth, roles(UserRole.SUPERADMIN)] as const;

organizationsRouter.get('/api/organizations', ...superadminOnly, asyncHandler(async (req, res) => {
  const { take, skip } = paginate(req);
  const organizations = await db.organization.findMany({
    take,
    skip,
    orderBy: { createdAt: 'desc' },
    include: {
      branding: true,
      _count: { select: { technicians: true, devices: true, users: true, trips: true } },
    },
  });
  res.json(organizations);
}));

organizationsRouter.post('/api/organizations', ...superadminOnly, asyncHandler(async (req, res) => {
  const parsed = z
    .object({
      name: z.string().min(1).max(80),
      slug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/),
      applicationName: z.string().min(1).max(80).optional(),
      timezone: z.string().max(60).optional(),
      country: z.string().max(60).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Name and a lowercase slug are required' });
  try {
    const organization = await db.organization.create({ data: { name: parsed.data.name, slug: parsed.data.slug } });
    const settings = await ensureOrganizationSettings(organization.id, {
      applicationName: parsed.data.applicationName,
      companyName: parsed.data.name,
      timezone: parsed.data.timezone,
      country: parsed.data.country,
    });
    await audit({ req, action: 'organization.create', resource: 'Organization', resourceId: organization.id, organizationId: organization.id });
    res.status(201).json({ ...organization, ...settings });
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'An organization with that slug already exists' });
    throw error;
  }
}));

organizationsRouter.patch('/api/organizations/:id', ...superadminOnly, asyncHandler(async (req, res) => {
  const parsed = z.object({ name: z.string().min(1).max(80).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid organization update' });
  const organization = await db.organization.update({ where: { id: String(req.params.id) }, data: parsed.data });
  await audit({ req, action: 'organization.update', resource: 'Organization', resourceId: organization.id, organizationId: organization.id });
  res.json(organization);
}));

/**
 * Remove an organization.
 *
 * Like device and technician removal this is guarded: an organization that still holds
 * data is refused until the caller repeats the request with `?purge=true`, which erases
 * every technician, device, GPS point, trip, alert, and branded setting it owns. Three
 * situations can never be purged, because each one would lock an operator out of the
 * system they are signed in to:
 *
 *   - the organization the caller is signed in to
 *   - the last remaining organization
 *   - an organization that still owns a superadmin account
 */
organizationsRouter.delete('/api/organizations/:id', ...superadminOnly, asyncHandler(async (req: AuthedRequest, res) => {
  const id = String(req.params.id);
  const organization = await db.organization.findUnique({ where: { id } });
  if (!organization) return res.status(404).json({ error: 'Organization not found' });

  if (req.user?.organizationId === organization.id) {
    return res.status(403).json({ error: 'You cannot remove the organization you are signed in to' });
  }
  if ((await db.organization.count()) <= 1) {
    return res.status(403).json({ error: 'The last organization cannot be removed; create another one first' });
  }
  const superadmins = await db.user.count({ where: { organizationId: organization.id, role: UserRole.SUPERADMIN } });
  if (superadmins > 0) {
    return res.status(403).json({ error: 'This organization still owns superadmin accounts. Reassign or remove them first.' });
  }

  const purge = req.query.purge === 'true';
  const [technicians, devices, users, locations, trips, alerts] = await Promise.all([
    db.technician.count({ where: { organizationId: organization.id } }),
    db.device.count({ where: { organizationId: organization.id } }),
    db.user.count({ where: { organizationId: organization.id } }),
    db.location.count({ where: { organizationId: organization.id } }),
    db.trip.count({ where: { organizationId: organization.id } }),
    db.alert.count({ where: { organizationId: organization.id } }),
  ]);

  if (technicians + devices + users + locations + trips + alerts > 0 && !purge) {
    return res.status(409).json({
      error: 'This organization still contains data. Disable it to keep the record, or confirm permanent erasure.',
      history: { locations, trips, alerts, devices, technicians, users },
      canPurge: true,
    });
  }

  await db.$transaction(async (tx) => {
    // Children first: trips cascade to their stops, alerts keep no organization link, and
    // user refresh tokens cascade while audit entries keep their history with a null user.
    await tx.trip.deleteMany({ where: { organizationId: organization.id } });
    await tx.location.deleteMany({ where: { organizationId: organization.id } });
    await tx.alert.deleteMany({ where: { organizationId: organization.id } });
    await tx.pairingCode.deleteMany({ where: { device: { organizationId: organization.id } } });
    await tx.device.deleteMany({ where: { organizationId: organization.id } });
    await tx.technician.deleteMany({ where: { organizationId: organization.id } });
    await tx.user.deleteMany({ where: { organizationId: organization.id } });
    await tx.branding.deleteMany({ where: { organizationId: organization.id } });
    await tx.trackingSetting.deleteMany({ where: { organizationId: organization.id } });
    await tx.retentionSetting.deleteMany({ where: { organizationId: organization.id } });
    await tx.organization.delete({ where: { id: organization.id } });
  });

  // The audit entry deliberately keeps no organization link (the row no longer exists) but
  // records the removed organization's id and slug for forensics.
  await audit({ req, action: purge ? 'organization.delete-purged' : 'organization.delete', resource: 'Organization', resourceId: organization.id, organizationId: null });
  res.json({ deleted: true, purged: purge, slug: organization.slug, erasedLocations: purge ? locations : 0, erasedTrips: purge ? trips : 0, erasedTechnicians: technicians, erasedDevices: devices, erasedUsers: users });
}));
