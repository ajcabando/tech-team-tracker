import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../db';
import { asyncHandler, audit, clientIp } from '../common';
import { auth, AuthedRequest, issueRefreshToken, rotateRefreshToken, token, hashToken, userOnly } from '../auth';
import { config } from '../config';

export const authRouter = Router();

/** Public branding so the login screen can render before authentication. */
authRouter.get('/api/branding/public', asyncHandler(async (_req, res) => {
  const branding = await db.branding.findFirst({ orderBy: { organizationId: 'asc' } });
  res.json(
    branding ?? {
      applicationName: config.defaults.applicationName,
      companyName: config.defaults.companyName,
      primaryColor: '#0ea5e9',
      secondaryColor: '#0f172a',
      timezone: config.defaults.timezone,
      country: config.defaults.country || null,
    },
  );
}));

authRouter.post('/api/auth/login', asyncHandler(async (req, res) => {
  const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Valid email and password are required' });

  const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() }, include: { organization: true } });
  if (!user || user.status !== 'ACTIVE' || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    if (user) {
      await db.auditLog.create({ data: { userId: user.id, organizationId: user.organizationId, action: 'auth.login', resource: 'User', resourceId: user.id, ipAddress: clientIp(req), result: 'FAILURE' } });
    }
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  // Technicians use the Android app, not the web dashboard.
  if (user.role === 'TECHNICIAN') {
    return res.status(403).json({ error: 'Technician accounts cannot access the web dashboard' });
  }
  if (user.organization && user.organization.status === 'DISABLED' && user.role !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'Organization is disabled' });
  }

  await db.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });
  const refreshToken = await issueRefreshToken(user.id);
  const branding = user.organizationId ? await db.branding.findUnique({ where: { organizationId: user.organizationId } }) : null;
  await db.auditLog.create({ data: { userId: user.id, organizationId: user.organizationId, action: 'auth.login', resource: 'User', resourceId: user.id, ipAddress: clientIp(req), result: 'SUCCESS' } });

  return res.json({
    accessToken: token({ id: user.id, organizationId: user.organizationId || undefined, role: user.role }),
    refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, organizationId: user.organizationId },
    branding,
  });
}));

authRouter.post('/api/auth/refresh', asyncHandler(async (req, res) => {
  const parsed = z.object({ refreshToken: z.string().min(10) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'refreshToken is required' });
  const rotated = await rotateRefreshToken(parsed.data.refreshToken);
  if (!rotated) return res.status(401).json({ error: 'Refresh token is invalid or expired' });
  const user = await db.user.findUnique({ where: { id: rotated.userId } });
  if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'Account is disabled' });
  res.json({
    accessToken: token({ id: user.id, organizationId: user.organizationId || undefined, role: user.role }),
    refreshToken: rotated.refreshToken,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, organizationId: user.organizationId },
  });
}));

authRouter.post('/api/auth/logout', asyncHandler(async (req, res) => {
  const parsed = z.object({ refreshToken: z.string().optional() }).safeParse(req.body);
  if (parsed.success && parsed.data.refreshToken) {
    await db.refreshToken.updateMany({ where: { tokenHash: hashToken(parsed.data.refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }
  res.json({ ok: true });
}));

authRouter.get('/api/auth/me', auth, userOnly, asyncHandler(async (req: AuthedRequest, res) => {
  const user = await db.user.findUnique({
    where: { id: req.user!.id },
    select: { id: true, name: true, email: true, phone: true, role: true, status: true, organizationId: true, organization: { select: { id: true, name: true, slug: true, status: true } } },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
}));

authRouter.post('/api/auth/change-password', auth, userOnly, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(128), confirmPassword: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success || parsed.data.newPassword !== parsed.data.confirmPassword) {
    return res.status(400).json({ error: 'New passwords must match and be at least 12 characters' });
  }
  const user = await db.user.findUnique({ where: { id: req.user!.id } });
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  await db.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) } });
  await db.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ req, action: 'auth.change-password', resource: 'User', resourceId: user.id });
  res.json({ ok: true });
}));
