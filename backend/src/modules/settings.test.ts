import { describe, expect, it } from 'vitest';

/**
 * Branding Zod schema — extracted to allow direct testing without DB.
 * The schema is kept in settings.ts but we re-define it here for unit
 * testing so we don't import the full router and its DB dependencies.
 *
 * NOTE: keep this mirror in sync with settings.ts. `imageUrl` accepts remote
 * https URLs and the base64 data URIs written by the asset upload endpoint —
 * plain `.url()` rejects data URIs, which once broke every branding save
 * after an upload.
 */
import { z } from 'zod';

const MAX_LOGO_CHARS = Math.ceil(((2 * 1024 * 1024) * 4) / 3) + 64;
const MAX_BG_CHARS = Math.ceil(((5 * 1024 * 1024) * 4) / 3) + 64;

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

const VALID = {
  applicationName: 'Tracker',
  companyName: 'Acme',
  primaryColor: '#0ea5e9',
  secondaryColor: '#0f172a',
  timezone: 'UTC',
};

const DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

  it('accepts base64 data URIs written by the asset upload endpoint', () => {
    const result = brandingBody.safeParse({
      ...VALID,
      logoUrl: DATA_URI,
      loginBackgroundUrl: DATA_URI,
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-image data URIs', () => {
    const result = brandingBody.safeParse({
      ...VALID,
      loginBackgroundUrl: 'data:text/html;base64,PGI+hiPC9iPg==',
    });
    expect(result.success).toBe(false);
  });

  it('rejects oversized data URIs past the upload cap', () => {
    const huge = `data:image/png;base64,${'A'.repeat(MAX_BG_CHARS)}`;
    const result = brandingBody.safeParse({ ...VALID, loginBackgroundUrl: huge });
    expect(result.success).toBe(false);
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
