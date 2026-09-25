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
  const [trips, locations, dayStops] = await Promise.all([
    db.trip.findMany({ where: { technicianId: technician.id, startedAt: { gte: startOfDay } }, orderBy: { startedAt: 'desc' } }),
    db.location.count({ where: { technicianId: technician.id, recordedAt: { gte: startOfDay } } }),
    db.dwellStop.findMany({
      where: { technicianId: technician.id, OR: [{ arrivedAt: { gte: startOfDay } }, { departedAt: { gte: startOfDay } }, { departedAt: null }] },
      select: { arrivedAt: true, departedAt: true },
    }),
  ]);
  const distanceToday = trips.reduce((sum, trip) => sum + trip.distanceMeters, 0);
  const drivingSeconds = trips.reduce((sum, trip) => sum + trip.drivingSeconds, 0);
  // Only the portion of each stop that falls inside today counts toward the total.
  const nowMs = Date.now();
  const stopSeconds = dayStops.reduce((sum, stop) => {
    const start = Math.max(stop.arrivedAt.getTime(), startOfDay.getTime());
    const end = stop.departedAt ? Math.min(stop.departedAt.getTime(), nowMs) : nowMs;
    return sum + Math.max(0, (end - start) / 1000);
  }, 0);
  res.json({
    ...technician,
    today: {
      distanceMeters: distanceToday,
      tripCount: trips.length,
      drivingSeconds,
      maxSpeed: trips.reduce((max, trip) => Math.max(max, trip.maxSpeed), 0),
      locationPoints: locations,
      stopSeconds: Math.round(stopSeconds),
      stopCount: dayStops.length,
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
  const rawTo = typeof req.query.to === 'string' ? req.query.to : null;
  const parsedTo = rawTo ? new Date(rawTo) : null;
  const to = parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : undefined;
  res.json(
    await db.location.findMany({
      where: { technicianId: String(req.params.id), ...orgScope(req.user), recordedAt: { gte: from, ...(to ? { lt: to } : {}) } },
      orderBy: { recordedAt: 'asc' },
      take: 10000,
    }),
  );
}));

/**
 * Motionless-stop records for a technician: every place they stayed still long
 * enough to be recorded, with the time spent there. Defaults to the current
 * UTC day; `from`/`to` select any range. Stops are matched by interval overlap
 * so a park spanning midnight appears on both days.
 */
techniciansRouter.get('/api/technicians/:id/stops', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ from: z.string().optional(), to: z.string().optional() }).safeParse(req.query);
  const dayStart = startOfUtcDay(new Date());
  const rawFrom = parsed.success ? parsed.data.from : undefined;
  const rawTo = parsed.success ? parsed.data.to : undefined;
  const from = rawFrom ? new Date(rawFrom) : dayStart;
  const to = rawTo ? new Date(rawTo) : new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    return res.status(400).json({ error: 'Invalid date range: expected from < to' });
  }

  const stops = await db.dwellStop.findMany({
    where: {
      technicianId: String(req.params.id),
      ...orgScope(req.user),
      arrivedAt: { lt: to },
      OR: [{ departedAt: null }, { departedAt: { gt: from } }],
    },
    orderBy: { arrivedAt: 'desc' },
    take: 500,
  });

  const nowMs = Date.now();
  res.json(
    stops.map((stop) => ({
      id: stop.id,
      latitude: stop.latitude,
      longitude: stop.longitude,
      arrivedAt: stop.arrivedAt,
      // An open stop keeps accruing time live, independent of the last recompute.
      departedAt: stop.departedAt,
      durationSeconds: stop.departedAt ? stop.durationSeconds : Math.max(stop.durationSeconds, Math.round((nowMs - stop.arrivedAt.getTime()) / 1000)),
      pointCount: stop.pointCount,
    })),
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
  const [locations, trips, stops, alerts, devices] = await Promise.all([
    db.location.count({ where: { technicianId: technician.id } }),
    db.trip.count({ where: { technicianId: technician.id } }),
    db.dwellStop.count({ where: { technicianId: technician.id } }),
    db.alert.count({ where: { technicianId: technician.id } }),
    db.device.count({ where: { technicianId: technician.id } }),
  ]);

  if ((locations > 0 || trips > 0 || stops > 0) && !purge) {
    return res.status(409).json({
      error: 'This technician has recorded GPS history. Deactivate them to keep the history, or confirm permanent erasure.',
      history: { locations, trips, stops, alerts, devices },
      canPurge: true,
    });
  }

  const result = await db.$transaction(async (tx) => {
    if (purge) {
      await tx.trip.deleteMany({ where: { technicianId: technician.id } }); // TripStop rows cascade
      await tx.dwellStop.deleteMany({ where: { technicianId: technician.id } });
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
  res.json({ deleted: true, purged: purge, erasedLocations: purge ? locations : 0, erasedTrips: purge ? trips : 0, erasedStops: purge ? stops : 0, ...result });
}));

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
