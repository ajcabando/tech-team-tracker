import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { ZodError } from 'zod';
import { config } from './config';
import { rateLimit } from './middleware/rateLimit';
import { healthRouter } from './modules/health';
import { setupRouter } from './modules/setup';
import { authRouter } from './modules/auth';
import { organizationsRouter } from './modules/organizations';
import { usersRouter } from './modules/users';
import { techniciansRouter } from './modules/technicians';
import { devicesRouter } from './modules/devices';
import { locationsRouter } from './modules/locations';
import { tripsRouter } from './modules/trips';
import { reportsRouter } from './modules/reports';
import { settingsRouter } from './modules/settings';
import { dashboardRouter } from './modules/dashboard';
import { alertsRouter } from './modules/alerts';
import { auditRouter } from './modules/audit';
import { openApiRouter } from './openapi';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigin, credentials: true }));
  // 8mb accommodates branding saves carrying base64 image data URIs (backgrounds
  // up to 5MB binary ≈ 6.8MB encoded). Per-field Zod length caps remain the real
  // guard; this is only the transport ceiling.
  app.use(express.json({ limit: '8mb' }));
  if (config.nodeEnv !== 'test') app.use(morgan('combined'));
  app.use(rateLimit({ windowMs: 60_000, max: 600 }));

  app.use(healthRouter);
  app.use(setupRouter);
  app.use(openApiRouter);
  // Login and pairing are brute-forceable; apply a tighter window BEFORE the routers.
  app.use(['/api/auth/login', '/api/auth/refresh', '/api/devices/pair'], rateLimit({ windowMs: 60_000, max: 20 }));
  app.use(authRouter);
  app.use(organizationsRouter);
  app.use(usersRouter);
  app.use(techniciansRouter);
  app.use(devicesRouter);
  app.use(locationsRouter);
  app.use(tripsRouter);
  app.use(reportsRouter);
  app.use(settingsRouter);
  app.use(dashboardRouter);
  app.use(alertsRouter);
  app.use(auditRouter);

  app.use('/api', (_req: Request, res: Response) => res.status(404).json({ error: 'Not found' }));

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ZodError) return res.status(400).json({ error: 'Validation failed', issues: error.issues });
    // Malformed JSON bodies surface as SyntaxError with a `body` property from express.json().
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Malformed JSON request body' });
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('unhandled-error', message);
    res.status(500).json({ error: config.isProduction ? 'Internal server error' : message });
  });

  return app;
}
