import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { db } from '../db';
import { auth, roles, AuthedRequest } from '../auth';
import { asyncHandler, audit, orgScope, paginate } from '../common';

export const usersRouter = Router();

const manageRoles = [UserRole.SUPERADMIN, UserRole.ADMIN] as const;

usersRouter.get('/api/users', auth, roles(...manageRoles), asyncHandler(async (req: AuthedRequest, res) => {
  const { take, skip } = paginate(req);
  res.json(
    await db.user.findMany({
      where: orgScope(req.user),
      take,
      skip,
      select: { id: true, name: true, email: true, phone: true, role: true, status: true, lastLogin: true, createdAt: true, organizationId: true },
      orderBy: { createdAt: 'desc' },
    }),
  );
}));

usersRouter.post('/api/users', auth, roles(...manageRoles), asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({
      name: z.string().min(1).max(100),
      email: z.string().email(),
      phone: z.string().max(40).optional(),
      password: z.string().min(12).max(128),
      role: z.nativeEnum(UserRole).default(UserRole.DISPATCHER),
      organizationId: z.string().optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Name, valid email, and a 12-character password are required', issues: parsed.error.issues });

  const isSuperadmin = req.user?.role === UserRole.SUPERADMIN;
  const organizationId = isSuperadmin ? parsed.data.organizationId ?? req.user?.organizationId : req.user?.organizationId;
  if (!organizationId) return res.status(400).json({ error: 'An organization is required' });
  if (!isSuperadmin && parsed.data.role === UserRole.ADMIN) return res.status(403).json({ error: 'Only a superadmin can create another admin' });
  if (!isSuperadmin && parsed.data.role === UserRole.SUPERADMIN) return res.status(403).json({ error: 'Only a superadmin can create a superadmin' });

  try {
    const user = await db.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        phone: parsed.data.phone,
        passwordHash: await bcrypt.hash(parsed.data.password, 12),
        role: parsed.data.role,
        organizationId,
      },
      select: { id: true, name: true, email: true, phone: true, role: true, status: true, organizationId: true, createdAt: true },
    });
    await audit({ req, action: 'user.create', resource: 'User', resourceId: user.id, organizationId });
    res.status(201).json(user);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return res.status(409).json({ error: 'Email is already in use' });
    throw error;
  }
}));

usersRouter.patch('/api/users/:id/status', auth, roles(...manageRoles), asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Status must be ACTIVE or DISABLED' });
  const target = await db.user.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.role === UserRole.SUPERADMIN && req.user?.role !== UserRole.SUPERADMIN) return res.status(403).json({ error: 'Cannot modify a superadmin' });
  if (target.id === req.user?.id && parsed.data.status === 'DISABLED') return res.status(400).json({ error: 'You cannot disable your own account' });

  const user = await db.user.update({ where: { id: target.id }, data: { status: parsed.data.status }, select: { id: true, name: true, email: true, role: true, status: true } });
  if (parsed.data.status === 'DISABLED') await db.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ req, action: `user.${parsed.data.status === 'DISABLED' ? 'disable' : 'enable'}`, resource: 'User', resourceId: target.id, organizationId: target.organizationId });
  res.json(user);
}));

/**
 * Owner-initiated password reset.
 *
 * SUPERADMIN-only (stricter than manageRoles, matching the Admin page gate). No current
 * password is required since the owner never knows it. All of the target's sessions are
 * revoked so a possibly-compromised session cannot survive the reset — mirroring the
 * self-service change-password and disable flows. The new password must be communicated
 * to the user out-of-band; it is never returned or logged.
 */
usersRouter.post('/api/users/:id/password', auth, roles(UserRole.SUPERADMIN), asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ newPassword: z.string().min(12).max(128), confirmPassword: z.string().min(1) })
    .safeParse(req.body);
  if (!parsed.success || parsed.data.newPassword !== parsed.data.confirmPassword) {
    return res.status(400).json({ error: 'New passwords must match and be at least 12 characters' });
  }
  const target = await db.user.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!target) return res.status(404).json({ error: 'User not found' });

  await db.user.update({ where: { id: target.id }, data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) } });
  await db.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ req, action: 'user.password-reset', resource: 'User', resourceId: target.id, organizationId: target.organizationId });
  res.json({ ok: true });
}));

/**
 * Remove a management account.
 *
 * The account is erased and every session it holds is revoked immediately. The audit trail is
 * preserved: entries the user authored stay in place with their account link cleared, and this
 * removal is recorded as a new entry. Two accounts can never be removed — your own, and the
 * last remaining superadmin — because either would lock an operator out of the system. Disable
 * an account instead when access should stop but the record must stay.
 */
usersRouter.delete('/api/users/:id', auth, roles(...manageRoles), asyncHandler(async (req: AuthedRequest, res) => {
  const target = await db.user.findFirst({ where: { id: String(req.params.id), ...orgScope(req.user) } });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.id === req.user?.id) return res.status(403).json({ error: 'You cannot remove your own account' });
  if (target.role === UserRole.SUPERADMIN && req.user?.role !== UserRole.SUPERADMIN) return res.status(403).json({ error: 'Cannot remove a superadmin' });
  if (target.role === UserRole.SUPERADMIN && (await db.user.count({ where: { role: UserRole.SUPERADMIN } })) <= 1) {
    return res.status(403).json({ error: 'The last superadmin cannot be removed; create another one first' });
  }

  const keptAuditEntries = await db.auditLog.count({ where: { userId: target.id } });
  await db.$transaction(async (tx) => {
    await tx.refreshToken.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.user.delete({ where: { id: target.id } });
  });

  await audit({ req, action: 'user.delete', resource: 'User', resourceId: target.id, organizationId: target.organizationId });
  res.json({ deleted: true, email: target.email, role: target.role, keptAuditEntries });
}));
