import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { auth, AuthedRequest } from '../auth';
import { asyncHandler, orgScope } from '../common';

export const reportsRouter = Router();

type TripRow = { technicianId: string; distanceMeters: number; drivingSeconds: number; maxSpeed: number; averageSpeed: number; stopCount: number; longestStopSeconds: number; startedAt: Date; endedAt: Date | null };

function summarize(trips: TripRow[]) {
  const averageSpeed = trips.length ? trips.reduce((sum, trip) => sum + trip.averageSpeed, 0) / trips.length : 0;
  return {
    totalTrips: trips.length,
    totalDistanceMeters: trips.reduce((sum, trip) => sum + trip.distanceMeters, 0),
    totalDrivingSeconds: trips.reduce((sum, trip) => sum + trip.drivingSeconds, 0),
    maxSpeed: trips.reduce((max, trip) => Math.max(max, trip.maxSpeed), 0),
    averageSpeed,
    totalStops: trips.reduce((sum, trip) => sum + trip.stopCount, 0),
    longestStopSeconds: trips.reduce((max, trip) => Math.max(max, trip.longestStopSeconds), 0),
    firstActivity: trips.reduce<Date | null>((min, trip) => (!min || trip.startedAt < min ? trip.startedAt : min), null),
    lastActivity: trips.reduce<Date | null>((max, trip) => {
      const end = trip.endedAt ?? trip.startedAt;
      return !max || end > max ? end : max;
    }, null),
  };
}

async function buildReport(req: AuthedRequest, from: Date, to: Date, technicianId?: string) {
  const trips = await db.trip.findMany({
    where: { ...orgScope(req.user), startedAt: { gte: from, lte: to }, ...(technicianId ? { technicianId } : {}) },
    include: { technician: { select: { id: true, name: true, employeeNumber: true } } },
    orderBy: { startedAt: 'asc' },
  });
  const perTechnician = trips.reduce<Record<string, { technicianId: string; name: string; employeeNumber: string; trips: TripRow[] }>>((accumulator, trip) => {
    const key = trip.technicianId;
    accumulator[key] ??= { technicianId: key, name: trip.technician.name, employeeNumber: trip.technician.employeeNumber, trips: [] };
    accumulator[key].trips.push(trip);
    return accumulator;
  }, {});
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    totals: summarize(trips),
    technicians: Object.values(perTechnician).map((entry) => ({ technicianId: entry.technicianId, name: entry.name, employeeNumber: entry.employeeNumber, ...summarize(entry.trips) })),
  };
}

function parseRange(from: Date, to: Date) {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return { from, to };
}

reportsRouter.get('/api/reports/daily', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ date: z.string().optional(), technicianId: z.string().optional() }).safeParse(req.query);
  const date = parsed.success && parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Invalid date' });
  const from = new Date(date);
  from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000 - 1);
  res.json(await buildReport(req, from, to, parsed.success ? parsed.data.technicianId : undefined));
}));

reportsRouter.get('/api/reports/weekly', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ date: z.string().optional(), technicianId: z.string().optional() }).safeParse(req.query);
  const anchor = parsed.success && parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (Number.isNaN(anchor.getTime())) return res.status(400).json({ error: 'Invalid date' });
  const from = new Date(anchor);
  from.setHours(0, 0, 0, 0);
  const day = from.getDay();
  from.setDate(from.getDate() - ((day + 6) % 7)); // start of ISO week (Monday)
  const range = parseRange(from, new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000 - 1));
  if (!range) return res.status(400).json({ error: 'Invalid range' });
  res.json(await buildReport(req, range.from, range.to, parsed.success ? parsed.data.technicianId : undefined));
}));

reportsRouter.get('/api/reports/monthly', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ date: z.string().optional(), technicianId: z.string().optional() }).safeParse(req.query);
  const anchor = parsed.success && parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (Number.isNaN(anchor.getTime())) return res.status(400).json({ error: 'Invalid date' });
  const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  const to = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1) - 1);
  res.json(await buildReport(req, from, to, parsed.success ? parsed.data.technicianId : undefined));
}));
