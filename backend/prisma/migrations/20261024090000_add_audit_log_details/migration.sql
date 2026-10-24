-- Structured context for audit entries that need more than action + resource.
-- The first user is admin-authorized APK installs, which record the device and
-- the build that was approved; existing rows stay valid with NULL.
ALTER TABLE "AuditLog" ADD COLUMN "details" JSONB;
