import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { UserRole } from '@prisma/client';
import { db } from '../db';
import { auth, roles, AuthedRequest } from '../auth';
import { asyncHandler, audit, requireOrganization } from '../common';
import { ensureOrganizationSettings, getRetention, getTracking } from '../services/settings';

export const settingsRouter = Router();

const brandableRoles = [UserRole.SUPERADMIN, UserRole.ADMIN] as const;

// ---------- Branding image validation + asset upload (logo / backgrounds) ----------

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_BG_BYTES = 5 * 1024 * 1024;
// Base64 inflates binary by 4/3, plus the data-URI prefix — mirrors the multer caps
// on the JSON save path so oversized payloads cannot bypass the upload limits.
const MAX_LOGO_CHARS = Math.ceil(MAX_LOGO_BYTES * 4 / 3) + 64;
const MAX_BG_CHARS = Math.ceil(MAX_BG_BYTES * 4 / 3) + 64;

/**
 * Accepts remote https URLs and data-URI images written by the asset upload
 * endpoint. Plain `z.string().url()` rejects data URIs, which previously made
 * every branding save fail after an upload.
 */
function imageUrl(maxChars: number) {
  return z.string().max(maxChars).refine(
    (value) => {
      // Data URIs parse as URLs, so test that shape first before the http(s) check.
      if (/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(value)) return true;
      try {
        return new URL(value).protocol === 'http:' || new URL(value).protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'Must be an http(s) URL or a base64 image data URI' },
  );
}

settingsRouter.get('/api/settings', auth, asyncHandler(async (req: AuthedRequest, res) => {
  if (!req.user?.organizationId) return res.json(null);
  const { branding } = await ensureOrganizationSettings(req.user.organizationId);
  res.json(branding);
}));

const brandingBody = z.object({
  applicationName: z.string().min(1).max(80),
  companyName: z.string().min(1).max(80),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  logoUrl: imageUrl(MAX_LOGO_CHARS).nullish(),
  faviconUrl: z.string().url().nullish(),
  loginBackgroundUrl: imageUrl(MAX_BG_CHARS).nullish(),
  supportEmail: z.string().email().nullish(),
  supportPhone: z.string().max(40).nullish(),
  timezone: z.string().min(1).max(60),
  country: z.string().max(60).nullish(),
});

settingsRouter.post('/api/settings', auth, roles(...brandableRoles), asyncHandler(async (req: AuthedRequest, res) => {
  const organizationId = requireOrganization(req, res);
  if (!organizationId) return;
  const parsed = brandingBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid branding settings', issues: parsed.error.issues });
  const data = {
    ...parsed.data,
    logoUrl: parsed.data.logoUrl || null,
    faviconUrl: parsed.data.faviconUrl || null,
    loginBackgroundUrl: parsed.data.loginBackgroundUrl || null,
    supportEmail: parsed.data.supportEmail || null,
    supportPhone: parsed.data.supportPhone || null,
    country: parsed.data.country || null,
  };
  const branding = await db.branding.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
  await audit({ req, action: 'settings.branding.update', resource: 'Branding', resourceId: branding.id, organizationId });
  res.json(branding);
}));

// ---------- Asset upload (logo / login background) ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BG_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    cb(null, allowed.includes(file.mimetype));
  },
});

const ASSET_FIELDS: Record<string, { dbField: 'logoUrl' | 'loginBackgroundUrl'; maxBytes: number }> = {
  logo: { dbField: 'logoUrl', maxBytes: MAX_LOGO_BYTES },
  background: { dbField: 'loginBackgroundUrl', maxBytes: MAX_BG_BYTES },
};

settingsRouter.post('/api/settings/assets', auth, roles(...brandableRoles), upload.single('file'), asyncHandler(async (req: AuthedRequest, res) => {
  const organizationId = requireOrganization(req, res);
  if (!organizationId) return;

  const kind = String(req.body.kind || '');
  const spec = ASSET_FIELDS[kind];
  if (!spec) return res.status(400).json({ error: 'Invalid asset kind. Expected "logo" or "background".' });

  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });
  if (file.size > spec.maxBytes) return res.status(400).json({ error: `File exceeds ${Math.round(spec.maxBytes / 1024 / 1024)} MB limit` });

  const dataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

  const branding = await db.branding.upsert({
    where: { organizationId },
    create: { organizationId, [spec.dbField]: dataUri, applicationName: '', companyName: '', primaryColor: '#0ea5e9', secondaryColor: '#0f172a', timezone: 'UTC' },
    update: { [spec.dbField]: dataUri },
  });
  await audit({ req, action: `settings.branding.${kind}.upload`, resource: 'Branding', resourceId: branding.id, organizationId });
  res.json(branding);
}));

// ---------- Tracking settings ----------

settingsRouter.get('/api/settings/tracking', auth, asyncHandler(async (req: AuthedRequest, res) => {
  if (!req.user?.organizationId) return res.status(400).json({ error: 'Organization required' });
  res.json(await getTracking(req.user.organizationId));
}));

const trackingBody = z.object({
  movingIntervalSeconds: z.number().int().min(1).max(600),
  walkingIntervalSeconds: z.number().int().min(1).max(600),
  stationaryIntervalSeconds: z.number().int().min(1).max(3600),
  lowBatteryIntervalSeconds: z.number().int().min(1).max(3600),
  stopTimeoutSeconds: z.number().int().min(30).max(7200),
  automaticTripDetection: z.boolean(),
  gpsAccuracyThresholdMeters: z.number().min(1).max(5000),
  lowBatteryThreshold: z.number().int().min(1).max(100),
});

settingsRouter.put('/api/settings/tracking', auth, roles(...brandableRoles), asyncHandler(async (req: AuthedRequest, res) => {
  const organizationId = requireOrganization(req, res);
  if (!organizationId) return;
  const parsed = trackingBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid tracking settings', issues: parsed.error.issues });
  await getTracking(organizationId);
  const tracking = await db.trackingSetting.update({ where: { organizationId }, data: parsed.data });
  await audit({ req, action: 'settings.tracking.update', resource: 'TrackingSetting', resourceId: tracking.id, organizationId });
  res.json(tracking);
}));

// ---------- Retention settings ----------

settingsRouter.get('/api/settings/retention', auth, asyncHandler(async (req: AuthedRequest, res) => {
  if (!req.user?.organizationId) return res.status(400).json({ error: 'Organization required' });
  res.json(await getRetention(req.user.organizationId));
}));

const retentionBody = z.object({
  rawLocationDays: z.number().int().min(1).max(3650),
  tripDays: z.number().int().min(1).max(3650),
  auditLogDays: z.number().int().min(1).max(3650),
});

settingsRouter.put('/api/settings/retention', auth, roles(...brandableRoles), asyncHandler(async (req: AuthedRequest, res) => {
  const organizationId = requireOrganization(req, res);
  if (!organizationId) return;
  const parsed = retentionBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid retention settings', issues: parsed.error.issues });
  const retention = await db.retentionSetting.update({ where: { organizationId }, data: parsed.data });
  await audit({ req, action: 'settings.retention.update', resource: 'RetentionSetting', resourceId: retention.id, organizationId });
  res.json(retention);
}));
