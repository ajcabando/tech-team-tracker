import { TripSource } from '@prisma/client';
import { db } from '../db';
import { detectTrips } from './trips';
import { getTracking } from './settings';
import { publish } from '../realtime';

const LOOKBACK_HOURS = 24;

/**
 * Recompute automatic trips for a device from its recent raw GPS points.
 * Idempotent: a detected trip is skipped when one already starts at the same instant,
 * so repeated batch uploads do not duplicate history.
 */
export async function computeTripsForDevice(device: { id: string; organizationId: string; technicianId: string | null }): Promise<number> {
  if (!device.technicianId) return 0;
  const tracking = await getTracking(device.organizationId);
  if (!tracking.automaticTripDetection) return 0;

  const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const points = await db.location.findMany({
    where: { deviceId: device.id, recordedAt: { gte: cutoff } },
    orderBy: { recordedAt: 'asc' },
    take: 20000,
    select: { latitude: true, longitude: true, recordedAt: true, accuracy: true, speed: true },
  });
  if (points.length < 2) return 0;

  const detected = detectTrips(points, { stopTimeoutSeconds: tracking.stopTimeoutSeconds });
  let created = 0;
  for (const trip of detected) {
    const existing = await db.trip.findFirst({ where: { technicianId: device.technicianId, startedAt: trip.startedAt } });
    if (existing) {
      await db.trip.update({
        where: { id: existing.id },
        data: {
          endedAt: trip.endedAt,
          distanceMeters: trip.distanceMeters,
          drivingSeconds: trip.drivingSeconds,
          maxSpeed: trip.maxSpeed,
          averageSpeed: trip.averageSpeed,
          stopCount: trip.stopCount,
          longestStopSeconds: trip.longestStopSeconds,
          pointCount: trip.pointCount,
          endLatitude: trip.endLatitude,
          endLongitude: trip.endLongitude,
        },
      });
      continue;
    }
    const record = await db.trip.create({
      data: {
        organizationId: device.organizationId,
        technicianId: device.technicianId,
        deviceId: device.id,
        source: TripSource.AUTO,
        startedAt: trip.startedAt,
        endedAt: trip.endedAt,
        startLatitude: trip.startLatitude,
        startLongitude: trip.startLongitude,
        endLatitude: trip.endLatitude,
        endLongitude: trip.endLongitude,
        distanceMeters: trip.distanceMeters,
        drivingSeconds: trip.drivingSeconds,
        maxSpeed: trip.maxSpeed,
        averageSpeed: trip.averageSpeed,
        stopCount: trip.stopCount,
        longestStopSeconds: trip.longestStopSeconds,
        pointCount: trip.pointCount,
        stops: {
          create: trip.stops.map((stop) => ({
            latitude: stop.latitude,
            longitude: stop.longitude,
            arrivedAt: stop.arrivedAt,
            departedAt: stop.departedAt,
            durationSeconds: stop.durationSeconds,
          })),
        },
      },
    });
    created += 1;
    publish({ type: 'trip', organizationId: device.organizationId, payload: { tripId: record.id, technicianId: device.technicianId, distanceMeters: record.distanceMeters } });
  }
  return created;
}
