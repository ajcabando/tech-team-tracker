import { Router } from 'express';
import { z } from 'zod';
import { TripSource, UserRole } from '@prisma/client';
import { db } from '../db';
import { auth, roles, AuthedRequest } from '../auth';
import { asyncHandler, audit, orgScope, paginate } from '../common';
import { detectTrips } from '../services/trips';
import { MAX_PLAUSIBLE_SPEED_KMH } from '../services/geo';

export const tripsRouter = Router();

tripsRouter.get('/api/trips', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ technicianId: z.string().optional(), from: z.string().optional(), to: z.string().optional() }).safeParse(req.query);
  const query = parsed.success ? parsed.data : {};
  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;
  const { take, skip } = paginate(req);
  res.json(
    await db.trip.findMany({
      where: {
        ...orgScope(req.user),
        ...(query.technicianId ? { technicianId: query.technicianId } : {}),
        ...(from || to ? { startedAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      include: { technician: { select: { id: true, name: true, employeeNumber: true } } },
      orderBy: { startedAt: 'desc' },
      take,
      skip,
    }),
  );
}));

tripsRouter.get('/api/trips/:id', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const trip = await db.trip.findFirst({
    where: { id: String(req.params.id), ...orgScope(req.user) },
    include: { technician: { select: { id: true, name: true, employeeNumber: true } }, stops: { orderBy: { arrivedAt: 'asc' } } },
  });
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.json(trip);
}));

tripsRouter.get('/api/trips/:id/route', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const trip = await db.trip.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.json(
    await db.location.findMany({
      where: { deviceId: trip.deviceId, organizationId: trip.organizationId, recordedAt: { gte: trip.startedAt, lte: trip.endedAt || new Date() } },
      orderBy: { recordedAt: 'asc' },
      take: 10000,
      select: { id: true, latitude: true, longitude: true, recordedAt: true, speed: true, heading: true, accuracy: true, quality: true, altitude: true, battery: true },
    }),
  );
}));

/** Timeline for playback: route points annotated with cumulative distance and elapsed time. */
tripsRouter.get('/api/trips/:id/replay', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const trip = await db.trip.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const device = await db.device.findUnique({ where: { id: trip.deviceId }, select: { iconType: true, iconColor: true } });
  const points = await db.location.findMany({
    where: { deviceId: trip.deviceId, organizationId: trip.organizationId, recordedAt: { gte: trip.startedAt, lte: trip.endedAt || new Date() }, quality: { not: 'POOR' } },
    orderBy: { recordedAt: 'asc' },
    take: 10000,
    select: { latitude: true, longitude: true, recordedAt: true, speed: true, heading: true, accuracy: true },
  });
  let cumulative = 0;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const frames = points.map((point, index) => {
    if (index > 0) {
      const previous = points[index - 1];
      const dLat = toRad(point.latitude - previous.latitude);
      const dLon = toRad(point.longitude - previous.longitude);
      const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(previous.latitude)) * Math.cos(toRad(point.latitude)) * Math.sin(dLon / 2) ** 2;
      cumulative += 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(x)));
    }
    return {
      ...point,
      offsetSeconds: Math.round((point.recordedAt.getTime() - trip.startedAt.getTime()) / 1000),
      distanceMeters: cumulative,
    };
  });
  res.json({ trip: { ...trip, iconType: device?.iconType ?? 'pin', iconColor: device?.iconColor ?? null }, frames });
}));

tripsRouter.get('/api/trips/:id/stops', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const trip = await db.trip.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  res.json(await db.tripStop.findMany({ where: { tripId: trip.id }, orderBy: { arrivedAt: 'asc' } }));
}));

/** Force trip detection for a technician's GPS history over an explicit window. */
tripsRouter.post('/api/trips/process', auth, roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.MANAGER), asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ technicianId: z.string(), from: z.string().datetime(), to: z.string().datetime() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'technicianId, from, and to are required' });

  const technician = await db.technician.findFirst({ where: { id: parsed.data.technicianId, ...orgScope(req.user) } });
  if (!technician) return res.status(404).json({ error: 'Technician not found' });

  const points = await db.location.findMany({
    where: { technicianId: technician.id, organizationId: technician.organizationId, recordedAt: { gte: new Date(parsed.data.from), lte: new Date(parsed.data.to) } },
    orderBy: { recordedAt: 'asc' },
    take: 10000,
  });
  if (points.length < 2) return res.status(400).json({ error: 'At least two GPS points are required' });

  const detected = detectTrips(points);
  const segment = detected[0];
  const trip = await db.trip.create({
    data: {
      organizationId: technician.organizationId,
      technicianId: technician.id,
      deviceId: points[0].deviceId,
      source: TripSource.MANUAL,
      startedAt: segment?.startedAt ?? points[0].recordedAt,
      endedAt: segment?.endedAt ?? points.at(-1)!.recordedAt,
      startLatitude: points[0].latitude,
      startLongitude: points[0].longitude,
      endLatitude: points.at(-1)!.latitude,
      endLongitude: points.at(-1)!.longitude,
      distanceMeters: segment?.distanceMeters ?? 0,
      drivingSeconds: segment?.drivingSeconds ?? Math.max(0, Math.round((points.at(-1)!.recordedAt.getTime() - points[0].recordedAt.getTime()) / 1000)),
      maxSpeed:
        segment?.maxSpeed ??
        Math.min(MAX_PLAUSIBLE_SPEED_KMH, Math.max(0, ...points.map((point) => point.speed ?? 0))),
      averageSpeed: segment?.averageSpeed ?? 0,
      stopCount: segment?.stopCount ?? 0,
      longestStopSeconds: segment?.longestStopSeconds ?? 0,
      pointCount: points.length,
      stops: segment
        ? {
            create: segment.stops.map((stop) => ({
              latitude: stop.latitude,
              longitude: stop.longitude,
              arrivedAt: stop.arrivedAt,
              departedAt: stop.departedAt,
              durationSeconds: stop.durationSeconds,
            })),
          }
        : undefined,
    },
  });
  await audit({ req, action: 'trip.process', resource: 'Trip', resourceId: trip.id, organizationId: technician.organizationId });
  res.status(201).json(trip);
}));
