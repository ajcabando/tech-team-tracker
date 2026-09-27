-- Adversarial layout fixture for scripts/audit-mobile.mjs.
--
-- The mobile audit is only meaningful against the longest values the API
-- actually accepts. Demo seed data has short, realistic names, and the layout
-- bugs this targets are all caused by long unbroken tokens — so without these
-- rows the audit reports PASS on a layout that is still broken.
--
-- Every value below is at, or one under, a real schema maximum:
--   Technician.name           120   backend/src/modules/technicians.ts
--   Technician.employeeNumber  60   backend/src/modules/technicians.ts
--   Device.deviceName          80   backend/src/modules/devices.ts
--   User.email               none   backend/src/modules/users.ts (z.string().email())
--   Branding.companyName       80   backend/src/modules/settings.ts
-- They are deliberately single unbroken tokens with no spaces, so nothing can
-- wrap on a space and only a real `overflow-wrap` rule can contain them.
--
-- Usage (dev stack only — this writes an 80-char device name and a 37-char
-- email into whatever database is pointed at):
--
--   docker compose exec -T postgres psql -U tracker -d tracker \
--     -v ON_ERROR_STOP=1 -f /dev/stdin < scripts/audit-adversarial-data.sql
--
-- Reverting is the `ROLLBACK`-equivalent at the bottom; run that to restore the
-- demo fleet. It is a separate invocation because psql commits per file.

\set ON_ERROR_STOP on

BEGIN;

INSERT INTO "Technician" (id, "organizationId", "employeeNumber", name, email, phone, status, "createdAt", "updatedAt")
VALUES (
  'ADV-TECH-0001',
  (SELECT id FROM "Organization" ORDER BY "createdAt" LIMIT 1),
  'E-EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE',
  'BartholomewWolfgangMaximilianFeatherstonehaughMontgomeryFitzwilliamAshworthPenningtonBlackwoodCavendishThornburyRavensworthAbernathy',
  'bartholomew.featherstonehaugh@companydomain.com',
  '+63 917 000 1111',
  'ACTIVE', NOW(), NOW()
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "Device" (
  id, "organizationId", "technicianId", "deviceUuid", "deviceName",
  manufacturer, model, "androidVersion", "appVersion", status,
  "batteryLevel", "lastLatitude", "lastLongitude", "lastSpeed", "lastAccuracy",
  "lastSeen", "iconType", "iconColor", "createdAt", "updatedAt"
) VALUES (
  'ADV-DEV-0001',
  (SELECT id FROM "Organization" ORDER BY "createdAt" LIMIT 1),
  'ADV-TECH-0001',
  'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  'ZephyrineQuixoticVermeulenXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  'Zephyrine',
  'QuixoticVermeulenXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  '15', '0.3.4', 'ACTIVE',
  4, 10.3157, 123.8854, 0, 8,
  NOW(), 'pin', '#b91c1c', NOW(), NOW()
)
ON CONFLICT ("id") DO NOTHING;

-- Shaped exactly like the watchdog message: an interpolated device name.
INSERT INTO "Alert" (id, "organizationId", "technicianId", "deviceId", type, severity, message, "createdAt")
VALUES
  ('ADV-ALERT-0001', (SELECT id FROM "Organization" ORDER BY "createdAt" LIMIT 1), 'ADV-TECH-0001', 'ADV-DEV-0001',
   'DEVICE_OFFLINE', 'WARNING',
   'ZephyrineQuixoticVermeulenXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX has not reported for 2h 14m',
   NOW()),
  ('ADV-ALERT-0002', (SELECT id FROM "Organization" ORDER BY "createdAt" LIMIT 1), 'ADV-TECH-0001', 'ADV-DEV-0001',
   'LOW_BATTERY', 'CRITICAL',
   'ZephyrineQuixoticVermeulenXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX battery at 4% and device offline for 6h 2m',
   NOW() - interval '5 minutes')
ON CONFLICT ("id") DO NOTHING;

-- Gives the dashboard's .trips-table-row and the /trips/:id replay readout the
-- 120-char name and 60-char employee number to lay out.
INSERT INTO "Trip" (
  id, "organizationId", "technicianId", "deviceId", "startedAt", "endedAt",
  "startLatitude", "startLongitude", "endLatitude", "endLongitude",
  "distanceMeters", "drivingSeconds", "maxSpeed", "averageSpeed", "createdAt", source
) VALUES (
  'ADV-TRIP-0001', (SELECT id FROM "Organization" ORDER BY "createdAt" LIMIT 1), 'ADV-TECH-0001', 'ADV-DEV-0001',
  NOW() - interval '3 hours', NOW() - interval '1 hour 12 minutes',
  10.3157, 123.8854, 10.3311, 123.9123,
  48213, 6240, 78, 31,
  NOW() - interval '3 hours', 'AUTO'
)
ON CONFLICT ("id") DO NOTHING;

-- The longest company name the branding form accepts, to stress .mobile-brand.
UPDATE "Branding" SET "companyName" = 'International Heavy Equipment and Field Services Group International'
WHERE id = (SELECT id FROM "Branding" ORDER BY "applicationName" LIMIT 1);

-- An uncapped email, to overflow .kv on /about.
UPDATE "User" SET email = 'bartholomew.featherstonehaugh@companydomain.com'
WHERE id = (SELECT id FROM "User" ORDER BY email LIMIT 1);

COMMIT;
