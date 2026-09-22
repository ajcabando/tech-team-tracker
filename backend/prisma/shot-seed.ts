import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * DEMO DATA ONLY — for screenshots and local walkthroughs. Never run against production.
 *
 * Builds a small fictional fleet ("Acme Field Services", Austin, TX) on top of the
 * organization created by seed.ts: 3 technicians, 3 paired devices (one per vehicle
 * icon type), recent GPS routes, 2 trips, alerts, and audit entries.
 *
 * Usage (inside the backend container):
 *   node dist/prisma/shot-seed.js
 */
const db = new PrismaClient();

const ORG_SLUG = process.env.SEED_ORG_SLUG || 'default';

// Downtown Austin loop — real OSM tiles make the map screenshots recognizable.
const ROUTE_A: Array<[number, number]> = [
  [30.2672, -97.7431],
  [30.2705, -97.7431],
  [30.2738, -97.7445],
  [30.2761, -97.7472],
  [30.2784, -97.7498],
  [30.2801, -97.7525],
  [30.2815, -97.7551],
];
const ROUTE_B: Array<[number, number]> = [
  [30.2672, -97.7431],
  [30.2645, -97.7412],
  [30.2618, -97.7395],
  [30.2592, -97.7381],
  [30.2566, -97.7372],
];

function interpolate(route: Array<[number, number]>, pointsPerLeg: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < route.length - 1; i += 1) {
    const [lat1, lng1] = route[i];
    const [lat2, lng2] = route[i + 1];
    for (let j = 0; j < pointsPerLeg; j += 1) {
      const t = j / pointsPerLeg;
      out.push([lat1 + (lat2 - lat1) * t, lng1 + (lng2 - lng1) * t]);
    }
  }
  out.push(route[route.length - 1]);
  return out;
}

async function main() {
  const organization = await db.organization.findUnique({ where: { slug: ORG_SLUG } });
  if (!organization) throw new Error(`Organization "${ORG_SLUG}" not found — run seed.ts first`);

  const now = Date.now();
  const techs = await Promise.all(
    [
      { employeeNumber: 'TECH-001', name: 'Alex Rivera', email: 'alex.rivera@example.com' },
      { employeeNumber: 'TECH-002', name: 'Jordan Lee', email: 'jordan.lee@example.com' },
      { employeeNumber: 'TECH-003', name: 'Sam Carter', email: 'sam.carter@example.com' },
    ].map((tech) =>
      db.technician.upsert({
        where: { organizationId_employeeNumber: { organizationId: organization.id, employeeNumber: tech.employeeNumber } },
        update: {},
        create: { ...tech, organizationId: organization.id },
      }),
    ),
  );

  const devices = await Promise.all(
    [
      { uuid: 'shot-device-001', name: 'Pixel 8 · Unit 1', tech: techs[0], iconType: 'car', iconColor: '#f97316' },
      { uuid: 'shot-device-002', name: 'Galaxy A54 · Unit 2', tech: techs[1], iconType: 'motorcycle', iconColor: '#22c55e' },
      { uuid: 'shot-device-003', name: 'Pixel 7a · Unit 3', tech: techs[2], iconType: 'pin', iconColor: null as string | null },
    ].map((device) =>
      db.device.upsert({
        where: { deviceUuid: device.uuid },
        update: {
          status: 'ACTIVE',
          technicianId: device.tech.id,
          iconType: device.iconType,
          iconColor: device.iconColor,
        },
        create: {
          deviceUuid: device.uuid,
          deviceName: device.name,
          manufacturer: 'Demo',
          model: 'Screenshot rig',
          androidVersion: '15',
          appVersion: '0.3.2',
          status: 'ACTIVE',
          organizationId: organization.id,
          technicianId: device.tech.id,
          iconType: device.iconType,
          iconColor: device.iconColor,
        },
      }),
    ),
  );

  // Device 1: moving right now (online + speed) along ROUTE_A.
  const routeA = interpolate(ROUTE_A, 6);
  const startA = now - routeA.length * 20_000;
  await db.location.createMany({
    data: routeA.map(([latitude, longitude], index) => ({
      id: randomUUID(),
      deviceId: devices[0].id,
      technicianId: techs[0].id,
      organizationId: organization.id,
      recordedAt: new Date(startA + index * 20_000),
      latitude,
      longitude,
      speed: 8 + Math.sin(index) * 2,
      heading: 25,
      accuracy: 6 + (index % 4),
      altitude: 150,
      battery: 82,
      networkState: 'cellular',
      quality: 'GOOD',
    })),
    skipDuplicates: true,
  });
  const [lastLatA, lastLngA] = routeA[routeA.length - 1];
  await db.device.update({
    where: { id: devices[0].id },
    data: { lastLatitude: lastLatA, lastLongitude: lastLngA, lastSpeed: 8.4, lastAccuracy: 7, lastHeading: 25, lastSeen: new Date(now - 30_000), batteryLevel: 82 },
  });

  // Device 2: idle (online, stationary) at the start of ROUTE_B.
  const [idleLat, idleLng] = ROUTE_B[0];
  await db.location.createMany({
    data: [0, 1, 2].map((index) => ({
      id: randomUUID(),
      deviceId: devices[1].id,
      technicianId: techs[1].id,
      organizationId: organization.id,
      recordedAt: new Date(now - (3 - index) * 45_000),
      latitude: idleLat,
      longitude: idleLng,
      speed: 0,
      heading: 0,
      accuracy: 9,
      altitude: 149,
      battery: 64,
      networkState: 'wifi',
      quality: 'GOOD',
    })),
    skipDuplicates: true,
  });
  await db.device.update({
    where: { id: devices[1].id },
    data: { lastLatitude: idleLat, lastLongitude: idleLng, lastSpeed: 0, lastAccuracy: 9, lastSeen: new Date(now - 90_000), batteryLevel: 64 },
  });

  // Device 3: offline (last seen 2h ago) at the end of ROUTE_B.
  const [offLat, offLng] = ROUTE_B[ROUTE_B.length - 1];
  await db.device.update({
    where: { id: devices[2].id },
    data: { lastLatitude: offLat, lastLongitude: offLng, lastSpeed: 0, lastAccuracy: 12, lastSeen: new Date(now - 2 * 3_600_000), batteryLevel: 18 },
  });

  // Two trips for device 1: one finished this morning, one in progress.
  const tripStart = now - 3 * 3_600_000;
  const finishedPoints = interpolate(ROUTE_B, 20);
  const finishedStepMs = (42 * 60_000) / finishedPoints.length;
  await db.location.createMany({
    data: finishedPoints.map(([latitude, longitude], index) => ({
      id: randomUUID(),
      deviceId: devices[0].id,
      technicianId: techs[0].id,
      organizationId: organization.id,
      recordedAt: new Date(tripStart + index * finishedStepMs),
      latitude,
      longitude,
      speed: 7 + Math.sin(index / 3) * 3,
      heading: 160,
      accuracy: 8,
      altitude: 149,
      battery: 90,
      networkState: 'cellular',
      quality: 'GOOD',
    })),
    skipDuplicates: true,
  });
  await db.trip.create({
    data: {
      organizationId: organization.id,
      technicianId: techs[0].id,
      deviceId: devices[0].id,
      source: 'AUTO',
      startedAt: new Date(tripStart),
      endedAt: new Date(tripStart + 42 * 60_000),
      startLatitude: ROUTE_B[0][0],
      startLongitude: ROUTE_B[0][1],
      endLatitude: ROUTE_B[ROUTE_B.length - 1][0],
      endLongitude: ROUTE_B[ROUTE_B.length - 1][1],
      distanceMeters: 3200,
      drivingSeconds: 1500,
      maxSpeed: 14.2,
      averageSpeed: 7.7,
      stopCount: 1,
      longestStopSeconds: 240,
      pointCount: finishedPoints.length,
      stops: {
        create: {
          latitude: ROUTE_B[2][0],
          longitude: ROUTE_B[2][1],
          arrivedAt: new Date(tripStart + 15 * 60_000),
          departedAt: new Date(tripStart + 19 * 60_000),
          durationSeconds: 240,
        },
      },
    },
  });
  const livePoints = interpolate(ROUTE_A, 6);
  const liveStart = now - livePoints.length * 20_000;
  await db.trip.create({
    data: {
      organizationId: organization.id,
      technicianId: techs[0].id,
      deviceId: devices[0].id,
      source: 'AUTO',
      startedAt: new Date(liveStart),
      endedAt: null,
      startLatitude: livePoints[0][0],
      startLongitude: livePoints[0][1],
      endLatitude: null,
      endLongitude: null,
      distanceMeters: 1800,
      drivingSeconds: 800,
      maxSpeed: 11.5,
      averageSpeed: 8.1,
      stopCount: 0,
      longestStopSeconds: 0,
      pointCount: livePoints.length,
    },
  });

  // Alerts: one critical unacknowledged (low battery, offline device), one acknowledged.
  await db.alert.createMany({
    data: [
      {
        organizationId: organization.id,
        technicianId: techs[2].id,
        deviceId: devices[2].id,
        type: 'LOW_BATTERY',
        severity: 'CRITICAL',
        message: 'Battery at 18% and device offline for 2 hours',
      },
      {
        organizationId: organization.id,
        technicianId: techs[0].id,
        deviceId: devices[0].id,
        type: 'TRIP_STARTED',
        severity: 'INFO',
        message: 'Started a trip',
        acknowledgedAt: new Date(now - 2 * 3_600_000),
      },
    ],
  });

  const owner = await db.user.findFirst({ where: { organizationId: organization.id, role: 'SUPERADMIN' } });
  if (owner) {
    await db.auditLog.createMany({
      data: [
        { userId: owner.id, organizationId: organization.id, action: 'auth.login', resource: 'User', resourceId: owner.id, result: 'SUCCESS', ipAddress: '127.0.0.1' },
        { userId: owner.id, organizationId: organization.id, action: 'device.icon.update', resource: 'Device', resourceId: devices[0].id, result: 'SUCCESS', ipAddress: '127.0.0.1' },
        { userId: owner.id, organizationId: organization.id, action: 'user.password-reset', resource: 'User', resourceId: owner.id, result: 'SUCCESS', ipAddress: '127.0.0.1' },
      ],
    });
  }

  console.log('Screenshot demo fleet created: 3 technicians, 3 devices, 2 trips, 2 alerts.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
