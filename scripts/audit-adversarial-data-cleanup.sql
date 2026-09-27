-- Revert scripts/audit-adversarial-data.sql.
--
--   docker compose exec -T postgres psql -U tracker -d tracker \
--     -v ON_ERROR_STOP=1 -f /dev/stdin < scripts/audit-adversarial-data-cleanup.sql
--
-- Safe to run more than once. Re-seeding the demo fleet afterwards is optional.

\set ON_ERROR_STOP on

BEGIN;

-- Alerts first: they reference the device, and the device is removed below.
DELETE FROM "Alert" WHERE id IN ('ADV-ALERT-0001', 'ADV-ALERT-0002');
-- Trips reference both the device and the technician.
DELETE FROM "Trip" WHERE id = 'ADV-TRIP-0001';
DELETE FROM "Location" WHERE "deviceId" = 'ADV-DEV-0001';
DELETE FROM "DwellStop" WHERE "technicianId" = 'ADV-TECH-0001';
DELETE FROM "PairingCode" WHERE "deviceId" = 'ADV-DEV-0001';
DELETE FROM "Device" WHERE id = 'ADV-DEV-0001';
DELETE FROM "Technician" WHERE id = 'ADV-TECH-0001';

COMMIT;

-- Branding and the admin email are user-editable, so only revert them if they
-- still hold the fixture's exact values — never clobber a real edit.
UPDATE "Branding" SET "companyName" = 'IGREY CONNECT'
WHERE "companyName" = 'International Heavy Equipment and Field Services Group International';

UPDATE "User" SET email = 'admin@example.com'
WHERE email = 'bartholomew.featherstonehaugh@companydomain.com';
