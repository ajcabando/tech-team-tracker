import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { db } from '../db';
import { auth, deviceAuth, durableDeviceAuth, roles, AuthedRequest, createDeviceCredential } from '../auth';
import { asyncHandler, audit, orgScope, paginate } from '../common';
import { publish } from '../realtime';
import { getTracking } from '../services/settings';
import { rateLimit } from '../middleware/rateLimit';

export const devicesRouter = Router();

/**
 * Device-facing configuration: the paired phone reads its adaptive tracking intervals,
 * technician identity, and branding. Uses durable device token, not JWT.
 */
devicesRouter.get('/api/device/config', rateLimit({ windowMs: 60_000, max: 120 }), durableDeviceAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const device = await db.device.findUnique({ where: { id: req.user!.id }, include: { technician: true } });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const [tracking, branding] = await Promise.all([
    getTracking(device.organizationId),
    db.branding.findUnique({ where: { organizationId: device.organizationId } }),
  ]);
  res.json({
    deviceId: device.id,
    status: device.status,
    technician: device.technician,
    tracking,
    branding,
  });
}));

function generatePairingCode(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase().match(/.{1,4}/g)!.join('-');
}

/**
 * Device admin password: the password-only gate on the phone's settings.
 * The admin may supply one when generating a pairing code; otherwise a random
 * 6-digit PIN is issued. Only the bcrypt hash is stored — the plaintext is
 * returned once in the pairing-code response and never again.
 */
function generateDeviceAdminSecret(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/** Short window a successful admin-password verification stays valid on the phone. */
const ADMIN_UNLOCK_TTL_MS = 5 * 60_000;

devicesRouter.get('/api/devices', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const { take, skip } = paginate(req);
  res.json(
    await db.device.findMany({
      where: { ...orgScope(req.user), ...(req.query.status ? { status: String(req.query.status) as 'PENDING' | 'ACTIVE' | 'DISABLED' } : {}) },
      take,
      skip,
      include: { technician: { select: { id: true, name: true, employeeNumber: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  );
}));

devicesRouter.get('/api/devices/:id', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const device = await db.device.findFirst({
    where: { id: String(req.params.id), ...orgScope(req.user) },
    include: { technician: { select: { id: true, name: true, employeeNumber: true } } },
  });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json(device);
}));

devicesRouter.patch('/api/devices/:id', auth, roles(UserRole.SUPERADMIN, UserRole.ADMIN), asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({
    iconType: z.enum(['pin', 'car', 'motorcycle']).optional(),
    iconColor: z.string().regex(/^#[0-9a-f]{6}$/i).nullable().optional(),
  }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid icon settings', issues: parsed.error.issues });

  const device = await db.device.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const updated = await db.device.update({ where: { id: device.id }, data: parsed.data });
  await audit({ req, action: 'device.icon.update', resource: 'Device', resourceId: device.id, organizationId: device.organizationId });
  res.json({ id: updated.id, iconType: updated.iconType, iconColor: updated.iconColor });
}));

devicesRouter.post('/api/devices/pairing-code', auth, roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.MANAGER), asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ technicianId: z.string(), deviceName: z.string().min(1).max(80), adminPassword: z.string().min(4).max(64).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'technicianId and deviceName are required' });

  const technician = await db.technician.findFirst({ where: { id: parsed.data.technicianId, ...orgScope(req.user) } });
  if (!technician) return res.status(404).json({ error: 'Technician not found in your organization' });

  const code = generatePairingCode();
  const adminPassword = parsed.data.adminPassword?.trim() || generateDeviceAdminSecret();
  const deviceUuid = crypto.randomUUID();
  const device = await db.device.create({
    data: {
      organizationId: technician.organizationId,
      technicianId: technician.id,
      deviceName: parsed.data.deviceName,
      deviceUuid,
      status: 'PENDING',
      deviceAdminSecretHash: await bcrypt.hash(adminPassword, 10),
    },
  });
  await db.pairingCode.create({
    data: { deviceId: device.id, deviceIdText: device.deviceUuid, codeHash: await bcrypt.hash(code, 10), expiresAt: new Date(Date.now() + 15 * 60_000) },
  });
  await audit({ req, action: 'device.pairing-code', resource: 'Device', resourceId: device.id, organizationId: technician.organizationId });
  res.status(201).json({ deviceId: device.id, deviceUuid: device.deviceUuid, technicianId: technician.id, pairingCode: code, adminPassword, expiresInSeconds: 900 });
}));

devicesRouter.post('/api/devices/pair', asyncHandler(async (req, res) => {
  const parsed = z
    .object({
      code: z.string().min(4),
      deviceUuid: z.string().min(8),
      manufacturer: z.string().max(60).optional(),
      model: z.string().max(80).optional(),
      androidVersion: z.string().max(20).optional(),
      appVersion: z.string().max(20).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid pairing request' });

  const candidates = await db.pairingCode.findMany({ where: { usedAt: null, expiresAt: { gt: new Date() } }, include: { device: true } });
  let matched: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    if (await bcrypt.compare(parsed.data.code.trim().toUpperCase(), candidate.codeHash)) {
      matched = candidate;
    }
  }
  if (!matched) return res.status(400).json({ error: 'Pairing code is invalid or expired' });

  const { code: _code, deviceUuid: _deviceUuid, ...metadata } = parsed.data;
  const { raw: credentialRaw, hash: credentialHash } = createDeviceCredential();
  const [, device] = await db.$transaction([
    db.pairingCode.update({ where: { id: matched.id, usedAt: null }, data: { usedAt: new Date() } }),
    db.device.update({
      where: { id: matched.deviceId },
      data: {
        status: 'ACTIVE',
        unpairedAt: null,
        deviceUuid: parsed.data.deviceUuid,
        credentialHash,
        ...metadata,
      },
    }),
  ]);
  publish({ type: 'device', organizationId: device.organizationId, payload: { deviceId: device.id, status: device.status } });

  res.json({
    deviceId: device.id,
    deviceUuid: device.deviceUuid,
    technicianId: device.technicianId,
    deviceToken: credentialRaw,
  });
}));

/** Unpair without deleting history: all past GPS points stay attached to the technician. */
devicesRouter.post('/api/devices/:id/unpair', auth, roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.MANAGER), asyncHandler(async (req: AuthedRequest, res) => {
  const device = await db.device.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const updated = await db.device.update({ where: { id: device.id }, data: { status: 'DISABLED', unpairedAt: new Date(), technicianId: null, credentialHash: null } });
  await db.pairingCode.updateMany({ where: { deviceId: device.id, usedAt: null }, data: { usedAt: new Date() } });
  await audit({ req, action: 'device.unpair', resource: 'Device', resourceId: device.id, organizationId: device.organizationId });
  publish({ type: 'device', organizationId: device.organizationId, payload: { deviceId: device.id, status: updated.status } });
  res.json(updated);
}));

/**
 * Remove a device.
 *
 * By default this is refused when the device has GPS history, because deleting those
 * points would rewrite a technician's location record. Repeat with `?purge=true` to
 * permanently erase the device's points as well.
 */
devicesRouter.delete('/api/devices/:id', auth, roles(UserRole.SUPERADMIN, UserRole.ADMIN), asyncHandler(async (req: AuthedRequest, res) => {
  const device = await db.device.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const purge = req.query.purge === 'true';
  const locationCount = await db.location.count({ where: { deviceId: device.id } });
  if (locationCount > 0 && !purge) {
    return res.status(409).json({
      error: 'This device has recorded GPS history. Unpair it to keep the history, or confirm erasure.',
      history: { locations: locationCount },
      canPurge: true,
    });
  }

  await db.$transaction(async (tx) => {
    await tx.pairingCode.deleteMany({ where: { deviceId: device.id } });
    if (purge) await tx.location.deleteMany({ where: { deviceId: device.id } });
    // Alerts are kept: their deviceId is set to NULL by the foreign key rather than erased.
    await tx.device.delete({ where: { id: device.id } });
  });

  await audit({ req, action: purge ? 'device.delete-purged' : 'device.delete', resource: 'Device', resourceId: device.id, organizationId: device.organizationId });
  publish({ type: 'device', organizationId: device.organizationId, payload: { deviceId: device.id, status: 'DELETED' } });
  res.json({ deleted: true, purged: purge, erasedLocations: purge ? locationCount : 0 });
}));

/** Generate a fresh single-use code for an existing device (re-pair after a factory reset). */
devicesRouter.post('/api/devices/:id/pairing-code', auth, roles(UserRole.SUPERADMIN, UserRole.ADMIN, UserRole.MANAGER), asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ adminPassword: z.string().min(4).max(64).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const device = await db.device.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  const code = generatePairingCode();
  const adminPassword = parsed.data.adminPassword?.trim() || generateDeviceAdminSecret();
  await db.pairingCode.updateMany({ where: { deviceId: device.id, usedAt: null }, data: { usedAt: new Date() } });
  await db.pairingCode.create({ data: { deviceId: device.id, deviceIdText: device.deviceUuid, codeHash: await bcrypt.hash(code, 10), expiresAt: new Date(Date.now() + 15 * 60_000) } });
  await db.device.update({ where: { id: device.id }, data: { deviceAdminSecretHash: await bcrypt.hash(adminPassword, 10), adminUnlockedUntil: null } });
  await audit({ req, action: 'device.pairing-code', resource: 'Device', resourceId: device.id, organizationId: device.organizationId });
  res.status(201).json({ deviceId: device.id, deviceUuid: device.deviceUuid, technicianId: device.technicianId, pairingCode: code, adminPassword, expiresInSeconds: 900 });
}));

// ---------------------------------------------------------------------------
// On-phone admin gate (password-only, no username). The password is the device
// admin secret issued with the pairing code. A successful verification unlocks
// privileged on-phone actions for ADMIN_UNLOCK_TTL_MS.
// ---------------------------------------------------------------------------

devicesRouter.post('/api/device/verify-admin', rateLimit({ windowMs: 10 * 60_000, max: 10 }), durableDeviceAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Password is required' });
  const device = await db.device.findUnique({ where: { id: req.user!.id } });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (!device.deviceAdminSecretHash) {
    await audit({ req, action: 'device.admin-verify', resource: 'Device', resourceId: device.id, result: 'FAILED', organizationId: device.organizationId });
    return res.status(400).json({ error: 'Device admin password is not configured' });
  }
  if (!(await bcrypt.compare(parsed.data.password, device.deviceAdminSecretHash))) {
    await audit({ req, action: 'device.admin-verify', resource: 'Device', resourceId: device.id, result: 'FAILED', organizationId: device.organizationId });
    return res.status(403).json({ error: 'Incorrect admin password' });
  }
  const unlockedUntil = new Date(Date.now() + ADMIN_UNLOCK_TTL_MS);
  await db.device.update({ where: { id: device.id }, data: { adminUnlockedUntil: unlockedUntil } });
  await audit({ req, action: 'device.admin-verify', resource: 'Device', resourceId: device.id, organizationId: device.organizationId });
  res.json({ unlocked: true, unlockedUntil });
}));

/**
 * Unpair initiated from the phone itself. Requires a fresh admin-password
 * verification: the technician cannot reach this without the admin secret.
 * Same terminal state as the dashboard unpair — history is kept.
 */
devicesRouter.post('/api/device/unpair', rateLimit({ windowMs: 60_000, max: 20 }), durableDeviceAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const device = await db.device.findUnique({ where: { id: req.user!.id } });
  if (!device) return res.status(404).json({ error: 'Device not found' });
  if (!device.adminUnlockedUntil || device.adminUnlockedUntil.getTime() < Date.now()) {
    return res.status(403).json({ error: 'Admin verification required' });
  }
  const updated = await db.device.update({
    where: { id: device.id },
    data: { status: 'DISABLED', unpairedAt: new Date(), technicianId: null, credentialHash: null, deviceAdminSecretHash: null, adminUnlockedUntil: null },
  });
  await db.pairingCode.updateMany({ where: { deviceId: device.id, usedAt: null }, data: { usedAt: new Date() } });
  await audit({ req, action: 'device.unpair', resource: 'Device', resourceId: device.id, organizationId: device.organizationId });
  publish({ type: 'device', organizationId: device.organizationId, payload: { deviceId: device.id, status: updated.status } });
  res.json({ unpaired: true });
}));

// ---------------------------------------------------------------------------
// Device-only trip endpoints (durable token, scoped to paired technician)
// ---------------------------------------------------------------------------

devicesRouter.get('/api/device/trips', rateLimit({ windowMs: 60_000, max: 120 }), durableDeviceAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const device = await db.device.findUnique({ where: { id: req.user!.id } });
  if (!device?.technicianId) return res.status(404).json({ error: 'Device not paired' });
  const { take, skip } = paginate(req);
  const trips = await db.trip.findMany({
    where: { technicianId: device.technicianId, organizationId: device.organizationId },
    orderBy: { startedAt: 'desc' },
    take,
    skip,
    select: { id: true, startedAt: true, endedAt: true, distanceMeters: true, drivingSeconds: true, maxSpeed: true, averageSpeed: true, stopCount: true, longestStopSeconds: true, pointCount: true },
  });
  res.json(trips);
}));

devicesRouter.get('/api/device/trips/:id/replay', rateLimit({ windowMs: 60_000, max: 60 }), durableDeviceAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const device = await db.device.findUnique({ where: { id: req.user!.id } });
  if (!device?.technicianId) return res.status(404).json({ error: 'Device not paired' });
  const trip = await db.trip.findFirst({ where: { id: String(req.params.id), technicianId: device.technicianId, organizationId: device.organizationId } });
  if (!trip) return res.status(404).json({ error: 'Trip not found' });
  const points = await db.location.findMany({
    where: { deviceId: trip.deviceId, organizationId: trip.organizationId, recordedAt: { gte: trip.startedAt, lte: trip.endedAt || new Date() }, quality: { not: 'POOR' } },
    orderBy: { recordedAt: 'asc' },
    take: 10000,
    select: { latitude: true, longitude: true, recordedAt: true, speed: true, heading: true, accuracy: true },
  });
  let cumulative = 0;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const frames = points.map((point, index) => {
    if (index > 0) {
      const prev = points[index - 1];
      const dLat = toRad(point.latitude - prev.latitude);
      const dLon = toRad(point.longitude - prev.longitude);
      const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(prev.latitude)) * Math.cos(toRad(point.latitude)) * Math.sin(dLon / 2) ** 2;
      cumulative += 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(x)));
    }
    return {
      latitude: point.latitude,
      longitude: point.longitude,
      recordedAt: point.recordedAt,
      speed: point.speed,
      heading: point.heading,
      elapsedSeconds: Math.round((point.recordedAt.getTime() - trip.startedAt.getTime()) / 1000),
      cumulativeDistanceMeters: cumulative,
    };
  });
  res.json({ trip: { id: trip.id, startedAt: trip.startedAt, endedAt: trip.endedAt, distanceMeters: trip.distanceMeters }, frames });
}));
