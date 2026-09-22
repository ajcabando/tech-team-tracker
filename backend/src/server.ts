import { createApp } from './app';
import { config, assertProductionSecrets } from './config';
import { db } from './db';
import { getSystemState } from './modules/setup';

const app = createApp();

async function bootstrap() {
  const missing = assertProductionSecrets();
  if (missing.length) {
    console.warn(`[security] ${missing.join(', ')} still use development defaults. Set strong secrets before production.`);
  }
  await getSystemState();
  await db.$queryRaw`SELECT 1`;
}

/** Apply retention windows for every organization once per day. */
function scheduleMaintenance() {
  const run = async () => {
    try {
      const organizations = await db.organization.findMany({ select: { id: true } });
      const { db: database } = await import('./db');
      for (const organization of organizations) {
        const retention = await database.retentionSetting.findUnique({ where: { organizationId: organization.id } });
        if (!retention) continue;
        const cutoff = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        await database.location.deleteMany({ where: { organizationId: organization.id, recordedAt: { lt: cutoff(retention.rawLocationDays) } } });
        await database.trip.deleteMany({ where: { organizationId: organization.id, startedAt: { lt: cutoff(retention.tripDays) } } });
        await database.auditLog.deleteMany({ where: { organizationId: organization.id, createdAt: { lt: cutoff(retention.auditLogDays) } } });
      }
    } catch (error) {
      console.error('retention-job-failed', error);
    }
  };
  setInterval(run, 24 * 60 * 60 * 1000).unref();
}

bootstrap()
  .then(() => {
    scheduleMaintenance();
    app.listen(config.port, () => console.log(`Tracker API listening on ${config.port}`));
  })
  .catch((error) => {
    console.error('startup-failed', error);
    process.exit(1);
  });
