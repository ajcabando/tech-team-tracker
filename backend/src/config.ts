import 'dotenv/config';

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
  version: '0.2.0',
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
