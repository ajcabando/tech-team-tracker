import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { UserRole } from '@prisma/client';

import { db } from '../db';
import { asyncHandler, clientIp } from '../common';
import { ensureOrganizationSettings } from '../services/settings';
import { config } from '../config';

export const setupRouter = Router();

const SETUP_ID = 'system';

export async function getSystemState() {
  return db.systemState.upsert({
    where: { id: SETUP_ID },
    update: {},
    create: { id: SETUP_ID, initialized: false },
  });
}

/**
 * Whether the system has been initialized. A database that already contains a superadmin
 * counts as initialized, so upgrading an older installation never re-offers the setup wizard
 * or allows a second superadmin to be created through it.
 */
export async function isInitialized(): Promise<boolean> {
  const state = await getSystemState();
  if (state.initialized) return true;
  const superadmins = await db.user.count({ where: { role: UserRole.SUPERADMIN } });
  return superadmins > 0;
}

/** Public status endpoint — safe to expose, reveals only whether setup is required. */
setupRouter.get('/api/setup/status', asyncHandler(async (_req, res) => {
  res.json({ initialized: await isInitialized(), applicationName: config.defaults.applicationName });
}));

const setupBody = z.object({
  companyName: z.string().min(1).max(80),
  applicationName: z.string().min(1).max(80),
  organizationSlug: z.string().min(2).max(60).regex(/^[a-z0-9-]+$/).optional(),
  superadminName: z.string().min(1).max(80),
  superadminEmail: z.string().email(),
  password: z.string().min(12).max(128),
  confirmPassword: z.string().min(1),
  timezone: z.string().max(60).optional(),
  country: z.string().max(60).optional(),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
});

setupRouter.post('/api/setup', asyncHandler(async (req, res) => {
  if (await isInitialized()) return res.status(409).json({ error: 'System is already initialized' });

  const parsed = setupBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid setup details', issues: parsed.error.issues });
  const body = parsed.data;
  if (body.password !== body.confirmPassword) return res.status(400).json({ error: 'Passwords do not match' });

  const slug = body.organizationSlug || body.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'organization';

  const result = await db.$transaction(async (tx) => {
    const organization = await tx.organization.upsert({
      where: { slug },
      update: { name: body.companyName },
      create: { name: body.companyName, slug },
    });
    const superadmin = await tx.user.create({
      data: {
        name: body.superadminName,
        email: body.superadminEmail.toLowerCase(),
        passwordHash: await bcrypt.hash(body.password, 12),
        role: UserRole.SUPERADMIN,
        organizationId: organization.id,
      },
      select: { id: true, name: true, email: true, role: true, organizationId: true },
    });
    await tx.systemState.update({ where: { id: SETUP_ID }, data: { initialized: true, initializedAt: new Date() } });
    await tx.auditLog.create({
      data: { userId: superadmin.id, organizationId: organization.id, action: 'system.initialize', resource: 'SystemState', resourceId: SETUP_ID, ipAddress: clientIp(req), result: 'SUCCESS' },
    });
    return { organization, superadmin };
  });

  const { branding, tracking } = await ensureOrganizationSettings(result.organization.id, {
    applicationName: body.applicationName,
    companyName: body.companyName,
    timezone: body.timezone,
    country: body.country,
  });
  if (body.primaryColor || body.secondaryColor) {
    await db.branding.update({
      where: { organizationId: result.organization.id },
      data: {
        ...(body.primaryColor ? { primaryColor: body.primaryColor } : {}),
        ...(body.secondaryColor ? { secondaryColor: body.secondaryColor } : {}),
      },
    });
  }

  res.status(201).json({ organization: result.organization, superadmin: result.superadmin, branding, tracking });
}));
