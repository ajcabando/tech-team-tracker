import { db } from '../db';
import { config } from '../config';

/** Create branding/tracking/retention rows for a new organization. */
export async function ensureOrganizationSettings(organizationId: string, overrides: { applicationName?: string; companyName?: string; timezone?: string; country?: string } = {}) {
  const branding = await db.branding.upsert({
    where: { organizationId },
    update: {},
    create: {
      organizationId,
      applicationName: overrides.applicationName || config.defaults.applicationName,
      companyName: overrides.companyName || config.defaults.companyName,
      timezone: overrides.timezone || config.defaults.timezone,
      country: overrides.country || config.defaults.country,
    },
  });
  const tracking = await db.trackingSetting.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
  const retention = await db.retentionSetting.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
  return { branding, tracking, retention };
}

export async function getTracking(organizationId: string) {
  return db.trackingSetting.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
}

export async function getRetention(organizationId: string) {
  return db.retentionSetting.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
}
