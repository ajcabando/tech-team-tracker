import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { auth, AuthedRequest } from '../auth';
import { asyncHandler, audit, orgScope, paginate } from '../common';

export const alertsRouter = Router();

alertsRouter.get('/api/alerts', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ acknowledged: z.enum(['true', 'false']).optional() }).safeParse(req.query);
  const { take, skip } = paginate(req);
  res.json(
    await db.alert.findMany({
      where: {
        ...orgScope(req.user),
        ...(parsed.success && parsed.data.acknowledged ? { acknowledgedAt: parsed.data.acknowledged === 'true' ? { not: null } : null } : {}),
      },
      include: { technician: { select: { id: true, name: true } }, device: { select: { id: true, deviceName: true } } },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    }),
  );
}));

alertsRouter.post('/api/alerts/:id/acknowledge', auth, asyncHandler(async (req: AuthedRequest, res) => {
  const alert = await db.alert.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!alert) return res.status(404).json({ error: 'Alert not found' });
  const updated = await db.alert.update({ where: { id: alert.id }, data: { acknowledgedAt: new Date() } });
  await audit({ req, action: 'alert.acknowledge', resource: 'Alert', resourceId: alert.id, organizationId: alert.organizationId });
  res.json(updated);
}));
