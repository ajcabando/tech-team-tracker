import { describe, expect, it } from 'vitest';

/**
 * Branding Zod schema — extracted to allow direct testing without DB.
 * The schema is kept in settings.ts but we re-define it here for unit
 * testing so we don't import the full router and its DB dependencies.
 */
import { z } from 'zod';

const brandingBody = z.object({
  applicationName: z.string().min(1).max(80),
  companyName: z.string().min(1).max(80),
  primaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  secondaryColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  logoUrl: z.string().url().nullish(),
  faviconUrl: z.string().url().nullish(),
  loginBackgroundUrl: z.string().url().nullish(),
  supportEmail: z.string().email().nullish(),
  supportPhone: z.string().max(40).nullish(),
  timezone: z.string().min(1).max(60),
  country: z.string().max(60).nullish(),
});

const VALID = {
  applicationName: 'Tracker',
  companyName: 'Acme',
  primaryColor: '#0ea5e9',
  secondaryColor: '#0f172a',
  timezone: 'UTC',
};

describe('branding schema', () => {
  it('accepts minimal valid payload', () => {
    expect(brandingBody.safeParse(VALID).success).toBe(true);
  });

  it('accepts null for optional fields (Prisma returns null)', () => {
    const result = brandingBody.safeParse({
      ...VALID,
      logoUrl: null,
      faviconUrl: null,
      loginBackgroundUrl: null,
      supportEmail: null,
      supportPhone: null,
      country: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts undefined for optional fields', () => {
    const result = brandingBody.safeParse({ ...VALID });
    expect(result.success).toBe(true);
  });

  it('accepts valid URLs for logo/favicon/background', () => {
    const result = brandingBody.safeParse({
      ...VALID,
      logoUrl: 'https://example.com/logo.png',
      faviconUrl: 'https://example.com/favicon.ico',
      loginBackgroundUrl: 'https://example.com/bg.webp',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid color', () => {
    const result = brandingBody.safeParse({ ...VALID, primaryColor: 'red' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = brandingBody.safeParse({ ...VALID, supportEmail: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid URL', () => {
    const result = brandingBody.safeParse({ ...VALID, logoUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects empty applicationName', () => {
    const result = brandingBody.safeParse({ ...VALID, applicationName: '' });
    expect(result.success).toBe(false);
  });
});
