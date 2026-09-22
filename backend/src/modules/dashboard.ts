import { Router } from 'express';
import { db } from '../db';
import { auth, AuthedRequest } from '../auth';
import { asyncHandler, orgScope } from '../common';
import { publish, subscribe, unsubscribe } from '../realtime';
import { verifyAccess } from '../auth';

export const dashboardRouter = Router();

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

dashboardRouter.get('/api/dashboard/live', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const devices = await db.device.findMany({
    where: { ...orgScope(req.user), status: 'ACTIVE' },
    include: { technician: { select: { id: true, name: true, employeeNumber: true } } },
    orderBy: { lastSeen: 'desc' },
  });
  res.json(devices);
}));

dashboardRouter.get('/api/dashboard/summary', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const scope = orgScope(req.user);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [technicians, devices, tripsToday] = await Promise.all([
    db.technician.count({ where: { ...scope, status: 'ACTIVE' } }),
    db.device.findMany({ where: { ...scope, status: 'ACTIVE' }, select: { lastSeen: true, lastSpeed: true, batteryLevel: true, lastAccuracy: true } }),
    db.trip.findMany({ where: { ...scope, startedAt: { gte: startOfDay } }, select: { distanceMeters: true, drivingSeconds: true, maxSpeed: true } }),
  ]);

  const now = Date.now();
  const online = devices.filter((device) => device.lastSeen && now - device.lastSeen.getTime() < ONLINE_WINDOW_MS);
  const moving = online.filter((device) => (device.lastSpeed ?? 0) >= 3);
  const idle = online.length - moving.length;
  const lowBattery = online.filter((device) => (device.batteryLevel ?? 100) <= 20);
  const poorGps = online.filter((device) => (device.lastAccuracy ?? 0) > 100);

  res.json({
    totalTechnicians: technicians,
    totalDevices: devices.length,
    online: online.length,
    moving: moving.length,
    idle,
    offline: devices.length - online.length,
    tripsToday: tripsToday.length,
    distanceTodayMeters: tripsToday.reduce((sum, trip) => sum + trip.distanceMeters, 0),
    drivingTodaySeconds: tripsToday.reduce((sum, trip) => sum + trip.drivingSeconds, 0),
    maxSpeedToday: tripsToday.reduce((max, trip) => Math.max(max, trip.maxSpeed), 0),
    lowBatteryCount: lowBattery.length,
    poorGpsCount: poorGps.length,
    serverTime: new Date().toISOString(),
  });
}));

/**
 * Server-Sent Events stream of live location/device/trip/alert updates.
 * EventSource cannot set headers, so the token is accepted as a query parameter.
 */
dashboardRouter.get('/api/dashboard/stream', (req, res) => {
  const raw = (typeof req.query.token === 'string' ? req.query.token : undefined) || req.headers.authorization?.replace('Bearer ', '');
  if (!raw) return res.status(401).json({ error: 'Authentication required' });
  let user;
  try {
    user = verifyAccess(raw);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const client = subscribe(res, user);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe(client);
  });
});
