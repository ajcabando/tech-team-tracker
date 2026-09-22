import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { durableDeviceAuth, AuthedRequest } from '../auth';
import { asyncHandler } from '../common';
import { rateLimit } from '../middleware/rateLimit';
import { classifyQuality, metersPerSecondToKmh } from '../services/geo';
import { getTracking } from '../services/settings';
import { computeTripsForDevice } from '../services/tripEngine';
import { publish } from '../realtime';

export const locationsRouter = Router();

const pointSchema = z.object({
  id: z.string().uuid(),
  recordedAt: z.string().datetime(),
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  speed: z.number().nonnegative().optional(),
  heading: z.number().optional(),
  accuracy: z.number().nonnegative().optional(),
  altitude: z.number().optional(),
  battery: z.number().int().gte(0).lte(100).optional(),
  networkState: z.string().max(40).optional(),
});

locationsRouter.post('/api/locations/batch', rateLimit({ windowMs: 60_000, max: 120 }), durableDeviceAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ points: z.array(pointSchema).min(1).max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid location batch', issues: parsed.error.issues });

  const device = await db.device.findUnique({ where: { id: req.user!.id } });
  if (!device?.technicianId) return res.status(403).json({ error: 'Device is not paired to a technician' });
  if (device.status === 'DISABLED') return res.status(403).json({ error: 'Device has been unpaired' });

  const tracking = await getTracking(device.organizationId);
  const points = [...parsed.data.points].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  const rows = points.map((point) => ({
    id: point.id,
    recordedAt: new Date(point.recordedAt),
    latitude: point.latitude,
    longitude: point.longitude,
    // Android reports speed in m/s; the platform stores/report km/h.
    speed: point.speed != null ? metersPerSecondToKmh(point.speed) : undefined,
    heading: point.heading,
    accuracy: point.accuracy,
    altitude: point.altitude,
    battery: point.battery,
    networkState: point.networkState,
    deviceId: device.id,
    technicianId: device.technicianId!,
    organizationId: device.organizationId,
    quality: classifyQuality(point, tracking.gpsAccuracyThresholdMeters),
  }));

  // Batch insert, skipping rows already stored. `createMany({skipDuplicates})` maps
  // to ON CONFLICT DO NOTHING on the (deviceId, recordedAt) unique index.
  const inserted = await db.location.createMany({ data: rows, skipDuplicates: true });
  const last = rows.at(-1)!;

  await db.device.update({
    where: { id: device.id },
    data: {
      lastLatitude: last.latitude,
      lastLongitude: last.longitude,
      lastSpeed: last.speed,
      lastAccuracy: last.accuracy,
      lastHeading: last.heading,
      batteryLevel: last.battery,
      lastSeen: last.recordedAt,
    },
  });

  try {
    await maybeRaiseAlerts(device.organizationId, device.technicianId!, device.id, tracking.lowBatteryThreshold, last.battery);
  } catch (error) {
    console.error('alert-evaluation-failed', error);
  }

  publish({
    type: 'location',
    organizationId: device.organizationId,
    payload: {
      deviceId: device.id,
      technicianId: device.technicianId,
      latitude: last.latitude,
      longitude: last.longitude,
      speed: last.speed ?? 0,
      heading: last.heading ?? null,
      accuracy: last.accuracy ?? null,
      battery: last.battery ?? null,
      recordedAt: last.recordedAt,
    },
  });

  try {
    await computeTripsForDevice({ id: device.id, organizationId: device.organizationId, technicianId: device.technicianId });
  } catch (error) {
    console.error('trip-detection-failed', error);
  }

  res.json({ accepted: inserted.count, duplicates: rows.length - inserted.count });
}));

async function maybeRaiseAlerts(organizationId: string, technicianId: string, deviceId: string, lowBatteryThreshold: number, battery?: number) {
  if (battery == null || battery > lowBatteryThreshold) return;
  const recent = await db.alert.findFirst({
    where: { deviceId, type: 'LOW_BATTERY', createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  if (recent) return;
  const alert = await db.alert.create({
    data: { organizationId, technicianId, deviceId, type: 'LOW_BATTERY', severity: 'WARNING', message: `Battery at ${battery}% (threshold ${lowBatteryThreshold}%)` },
  });
  publish({ type: 'alert', organizationId, payload: alert });
}
