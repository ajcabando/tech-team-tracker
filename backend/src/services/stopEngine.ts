import { Prisma } from '@prisma/client';
import { db } from '../db';
import { getTracking } from './settings';
import { haversine } from './geo';
import { detectStops } from './stops';

const LOOKBACK_HOURS = 24;
/** A detected stop starting within this of the first point continues a park from before the window. */
const CONTINUITY_GRACE_MS = 5 * 60 * 1000;

/**
 * Recompute motionless-stop records for a device from its recent raw GPS points.
 *
 * Idempotent: every row touching the lookback window is deleted and re-derived on
 * each pass, so repeated batch uploads never duplicate history. A stop that began
 * before the window keeps its original arrival time (and row id) by adopting it
 * from the prior row — that is what keeps a multi-day park stable instead of
 * resetting its start to "now minus 24h" on every upload.
 */
export async function computeStopsForDevice(device: { id: string; organizationId: string; technicianId: string | null }): Promise<number> {
  if (!device.technicianId) return 0;
  const tracking = await getTracking(device.organizationId);
  const now = new Date();
  const windowStart = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const radius = tracking.stopClusterRadiusMeters;

  const points = await db.location.findMany({
    where: { deviceId: device.id, recordedAt: { gte: windowStart } },
    orderBy: { recordedAt: 'asc' },
    take: 20000,
    select: { latitude: true, longitude: true, recordedAt: true, accuracy: true, speed: true },
  });
  if (points.length < 2) return 0;

  const streamStart = points[0].recordedAt;
  const detected = detectStops(points, {
    minStopSeconds: tracking.stopTimeoutSeconds,
    clusterRadiusMeters: radius,
  });

  const prior = await db.dwellStop.findMany({
    where: {
      technicianId: device.technicianId,
      OR: [{ arrivedAt: { gte: windowStart } }, { departedAt: { gte: windowStart } }, { departedAt: null }],
    },
    orderBy: { arrivedAt: 'asc' },
  });

  let carriedId: string | undefined;
  if (detected.length > 0) {
    const first = detected[0];
    const match = prior.find(
      (row) =>
        row.arrivedAt.getTime() < first.arrivedAt.getTime() &&
        haversine(row, first) <= radius &&
        (row.departedAt !== null
          ? row.departedAt.getTime() >= first.arrivedAt.getTime()
          : first.arrivedAt.getTime() - streamStart.getTime() <= CONTINUITY_GRACE_MS),
    );
    if (match) {
      first.arrivedAt = match.arrivedAt;
      const end = first.departedAt ?? now;
      first.durationSeconds = Math.max(0, Math.round((end.getTime() - first.arrivedAt.getTime()) / 1000));
      carriedId = match.id;
    }
  }

  const rows: Prisma.DwellStopCreateManyInput[] = detected.map((stop, index) => ({
    ...(index === 0 && carriedId ? { id: carriedId } : {}),
    organizationId: device.organizationId,
    technicianId: device.technicianId!,
    deviceId: device.id,
    latitude: stop.latitude,
    longitude: stop.longitude,
    arrivedAt: stop.arrivedAt,
    departedAt: stop.departedAt,
    durationSeconds: stop.durationSeconds,
    pointCount: stop.pointCount,
  }));

  const carried = new Set<string>();
  if (carriedId) carried.add(carriedId);
  for (const row of prior) {
    // Rows fully inside the window are owned by detection; it either re-derives
    // them or they no longer hold under the current settings.
    if (row.arrivedAt.getTime() >= windowStart.getTime()) continue;
    if (carried.has(row.id)) continue;
    // A stop that started before the window but is not re-derived: finalize open
    // ones at the window boundary (detection can only see from there) and keep
    // closed ones untouched so history outside the window is never rewritten.
    const open = row.departedAt === null;
    const departedAt = open ? windowStart : row.departedAt!;
    rows.push({
      id: row.id,
      organizationId: row.organizationId,
      technicianId: row.technicianId,
      deviceId: row.deviceId,
      latitude: row.latitude,
      longitude: row.longitude,
      arrivedAt: row.arrivedAt,
      departedAt,
      durationSeconds: open ? Math.max(0, Math.round((departedAt.getTime() - row.arrivedAt.getTime()) / 1000)) : row.durationSeconds,
      pointCount: row.pointCount,
    });
  }

  await db.$transaction([
    db.dwellStop.deleteMany({
      where: {
        technicianId: device.technicianId,
        OR: [{ arrivedAt: { gte: windowStart } }, { departedAt: { gte: windowStart } }, { departedAt: null }],
      },
    }),
    ...(rows.length > 0 ? [db.dwellStop.createMany({ data: rows })] : []),
  ]);
  return rows.length;
}
