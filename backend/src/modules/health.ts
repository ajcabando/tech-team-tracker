import { Router } from 'express';
import { db } from '../db';
import { config } from '../config';
import { asyncHandler } from '../common';
import { subscriberCount } from '../realtime';

export const healthRouter = Router();

healthRouter.get('/health', asyncHandler(async (_req, res) => {
  let database = 'unavailable';
  try {
    await db.$queryRaw`SELECT 1`;
    database = 'ok';
  } catch {
    database = 'unavailable';
  }
  res.status(database === 'ok' ? 200 : 503).json({
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    version: config.version,
    uptimeSeconds: Math.round(process.uptime()),
    subscribers: subscriberCount(),
  });
}));

healthRouter.get('/health/database', asyncHandler(async (_req, res) => {
  try {
    await db.$queryRaw`SELECT 1`;
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
}));

healthRouter.get('/health/version', (_req, res) => {
  res.json({ version: config.version, nodeEnv: config.nodeEnv });
});
