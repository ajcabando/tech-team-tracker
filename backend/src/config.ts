import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The release version lives in the single VERSION file at the repository root so
 * the backend, the dashboard, and the Android APK can never drift apart. The
 * dashboard reads it back from /health/version instead of hardcoding a literal.
 *
 * The file is not in the image (the build context is ./backend), so it is bind
 * mounted to /app/VERSION. Both locations are tried to keep `npm run dev`
 * working without Docker.
 */
function readVersion(): string {
  const override = process.env.APP_VERSION?.trim();
  if (override) return override;
  for (const candidate of ['VERSION', '../VERSION', '../../VERSION']) {
    try {
      const contents = readFileSync(resolve(process.cwd(), candidate), 'utf8').trim();
      if (contents) return contents;
    } catch {
      // Try the next candidate.
    }
  }
  // Only reachable if the file is missing entirely, which the release check
  // treats as a build failure.
  return 'unknown';
}

function int(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: int('API_PORT', 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  jwtSecret: process.env.JWT_SECRET || 'development-only-change-me',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'development-only-refresh-change-me',
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL || '15m',
  refreshTokenDays: int('REFRESH_TOKEN_DAYS', 30),
  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  version: readVersion(),
  defaults: {
    applicationName: process.env.DEFAULT_APPLICATION_NAME || 'COMPANY TRACKER',
    companyName: process.env.DEFAULT_COMPANY_NAME || 'COMPANY',
    timezone: process.env.DEFAULT_TIMEZONE || 'UTC',
    country: process.env.DEFAULT_COUNTRY || '',
  },
};

/** Access tokens must never be signed with the development fallback in production. */
export function assertProductionSecrets(): string[] {
  if (!config.isProduction) return [];
  const warnings: string[] = [];
  if (config.jwtSecret.startsWith('development-only')) warnings.push('JWT_SECRET');
  if (config.jwtRefreshSecret.startsWith('development-only')) warnings.push('JWT_REFRESH_SECRET');
  return warnings;
}
