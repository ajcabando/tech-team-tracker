import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';

const db = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'change-this-password';
  const companyName = process.env.DEFAULT_COMPANY_NAME || 'COMPANY';
  const applicationName = process.env.DEFAULT_APPLICATION_NAME || 'COMPANY TRACKER';
  const slug = process.env.SEED_ORG_SLUG || 'default';

  const organization = await db.organization.upsert({
    where: { slug },
    update: {},
    create: { name: companyName, slug },
  });

  await db.branding.upsert({
    where: { organizationId: organization.id },
    update: {},
    create: {
      organizationId: organization.id,
      applicationName,
      companyName,
      timezone: process.env.DEFAULT_TIMEZONE || 'UTC',
      country: process.env.DEFAULT_COUNTRY || null,
    },
  });
  await db.trackingSetting.upsert({ where: { organizationId: organization.id }, update: {}, create: { organizationId: organization.id } });
  await db.retentionSetting.upsert({ where: { organizationId: organization.id }, update: {}, create: { organizationId: organization.id } });

  await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name: 'System Owner', passwordHash: await bcrypt.hash(password, 12), role: UserRole.SUPERADMIN, organizationId: organization.id },
  });

  await db.systemState.upsert({ where: { id: 'system' }, update: { initialized: true, initializedAt: new Date() }, create: { id: 'system', initialized: true, initializedAt: new Date() } });

  console.log(`Seeded ${email} for organization "${companyName}". Change the development password before exposing the service.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
