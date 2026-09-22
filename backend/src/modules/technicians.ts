import { Router } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { db } from '../db';
import { auth, roles, AuthedRequest } from '../auth';
import { asyncHandler, audit, orgScope, paginate } from '../common';

export const techniciansRouter = Router();

const deviceSelect = {
  id: true,
  deviceName: true,
  status: true,
  batteryLevel: true,
  lastLatitude: true,
  lastLongitude: true,
  lastSpeed: true,
  lastAccuracy: true,
  lastHeading: true,
  lastSeen: true,
  appVersion: true,
  androidVersion: true,
  unpairedAt: true,
  iconType: true,
  iconColor: true,
} as const;

techniciansRouter.get('/api/technicians', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const { take, skip } = paginate(req);
  res.json(
    await db.technician.findMany({
      where: { ...orgScope(req.user), ...(req.query.status ? { status: String(req.query.status) as 'ACTIVE' | 'DISABLED' } : {}) },
      take,
      skip,
      include: { devices: { select: deviceSelect, orderBy: { createdAt: 'desc' } } },
      orderBy: { name: 'asc' },
    }),
  );
}));

techniciansRouter.post('/api/technicians', auth, roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.MANAGER), asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      name: z.string().min(1).max(120),
      employeeNumber: z.string().min(1).max(60),
      email: z.string().email().optional(),
      phone: z.string().max(40).optional(),
      organizationId: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid technician', issues: parsed.error.issues });

  const organizationId = req.user?.role === UserRole.SUPERADMIN ? parsed.data.organizationId ?? req.user?.organizationId : req.user?.organizationId;
  if (!organizationId) return res.status(400).json({ error: 'An organization is required' });

  try {
    const technician = await db.technician.create({ data: { name: parsed.data.name, employeeNumber: parsed.data.employeeNumber, email: parsed.data.email, phone: parsed.data.phone, organizationId } });
    await audit({ req, action: 'technician.create', resource: 'Technician', resourceId: technician.id, organizationId });
    res.status(201).json(technician);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Employee number already exists in this organization' });
    throw error;
  }
}));

techniciansRouter.get('/api/technicians/:id', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const technician = await db.technician.findFirst({
    where: { id: String(req.params.id), ...orgScope(req.user) },
    include: { devices: { select: deviceSelect, orderBy: { createdAt: 'desc' } } },
  });
  if (!technician) return res.status(404).json({ error: 'Technician not found' });

  const startOfDay = startOfUtcDay(new Date());
  const [trips, locations] = await Promise.all([
    db.trip.findMany({ where: { technicianId: technician.id, startedAt: { gte: startOfDay } }, orderBy: { startedAt: 'desc' } }),
    db.location.count({ where: { technicianId: technician.id, recordedAt: { gte: startOfDay } } }),
  ]);
  const distanceToday = trips.reduce((sum, trip) => sum + trip.distanceMeters, 0);
  const drivingSeconds = trips.reduce((sum, trip) => sum + trip.drivingSeconds, 0);
  res.json({
    ...technician,
    today: {
      distanceMeters: distanceToday,
      tripCount: trips.length,
      drivingSeconds,
      maxSpeed: trips.reduce((max, trip) => Math.max(max, trip.maxSpeed), 0),
      locationPoints: locations,
      firstActivity: locations ? trips.at(-1)?.startedAt ?? null : null,
      lastActivity: trips[0]?.endedAt ?? trips[0]?.startedAt ?? null,
    },
  });
}));

techniciansRouter.patch('/api/technicians/:id', auth, roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.MANAGER), asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ name: z.string().min(1).max(120).optional(), email: z.string().email().optional(), phone: z.string().max(40).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid technician update' });
  const existing = await db.technician.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!existing) return res.status(404).json({ error: 'Technician not found' });
  const technician = await db.technician.update({ where: { id: existing.id }, data: parsed.data });
  await audit({ req, action: 'technician.update', resource: 'Technician', resourceId: technician.id, organizationId: technician.organizationId });
  res.json(technician);
}));

techniciansRouter.get('/api/technicians/:id/trips', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ from: z.string().optional(), to: z.string().optional() }).safeParse(req.query);
  const from = parsed.success && parsed.data.from ? new Date(parsed.data.from) : undefined;
  const to = parsed.success && parsed.data.to ? new Date(parsed.data.to) : undefined;
  const { take, skip } = paginate(req);
  res.json(
    await db.trip.findMany({
      where: {
        technicianId: String(req.params.id),
        ...orgScope(req.user),
        ...(from || to ? { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take,
      skip,
    }),
  );
}));

techniciansRouter.get('/api/technicians/:id/locations', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const rawFrom = typeof req.query.from === 'string' ? req.query.from : null;
  const parsedFrom = rawFrom ? new Date(rawFrom) : new Date(Date.now() - 86400000);
  const from = Number.isNaN(parsedFrom.getTime()) ? new Date(Date.now() - 86400000) : parsedFrom;
  res.json(
    await db.location.findMany({
      where: { technicianId: String(req.params.id), ...orgScope(req.user), recordedAt: { gte: from } },
      orderBy: { recordedAt: 'asc' },
      take: 10000,
    }),
  );
}));

/**
 * Remove a technician.
 *
 * Refused while the technician has GPS history, because erasing it would rewrite the
 * location record. Repeat with `?purge=true` to permanently erase their points and trips.
 * Devices are detached: ones with no history are deleted, the rest are unpaired so any
 * remaining points keep their attribution.
 */
techniciansRouter.delete('/api/technicians/:id', auth, roles(UserRole.SUPERADMIN, UserRole.ADMIN), asyncHandler(async (req: AuthedRequest, res) => {
  const technician = await db.technician.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!technician) return res.status(404).json({ error: 'Technician not found' });

  const purge = req.query.purge === 'true';
  const [locations, trips, alerts, devices] = await Promise.all([
    db.location.count({ where: { technicianId: technician.id } }),
    db.trip.count({ where: { technicianId: technician.id } }),
    db.alert.count({ where: { technicianId: technician.id } }),
    db.device.count({ where: { technicianId: technician.id } }),
  ]);

  if ((locations > 0 || trips > 0) && !purge) {
    return res.status(409).json({
      error: 'This technician has recorded GPS history. Deactivate them to keep the history, or confirm permanent erasure.',
      history: { locations, trips, alerts, devices },
      canPurge: true,
    });
  }

  const result = await db.$transaction(async (tx) => {
    if (purge) {
      await tx.trip.deleteMany({ where: { technicianId: technician.id } }); // TripStop rows cascade
      await tx.location.deleteMany({ where: { technicianId: technician.id } });
    }

    const owned = await tx.device.findMany({ where: { technicianId: technician.id }, select: { id: true } });
    let deletedDevices = 0;
    let unpairedDevices = 0;
    for (const device of owned) {
      // A reassigned device can still hold points attributed to another technician.
      const remaining = await tx.location.count({ where: { deviceId: device.id } });
      if (remaining === 0) {
        await tx.pairingCode.deleteMany({ where: { deviceId: device.id } });
        await tx.device.delete({ where: { id: device.id } });
        deletedDevices += 1;
      } else {
        await tx.device.update({ where: { id: device.id }, data: { technicianId: null, status: 'DISABLED', unpairedAt: new Date() } });
        unpairedDevices += 1;
      }
    }

    await tx.technician.delete({ where: { id: technician.id } });
    return { deletedDevices, unpairedDevices };
  });

  await audit({ req, action: purge ? 'technician.delete-purged' : 'technician.delete', resource: 'Technician', resourceId: technician.id, organizationId: technician.organizationId });
  res.json({ deleted: true, purged: purge, erasedLocations: purge ? locations : 0, erasedTrips: purge ? trips : 0, ...result });
}));

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
