-- AlterTable
ALTER TABLE "Device" ADD COLUMN "deviceAdminSecretHash" TEXT;
ALTER TABLE "Device" ADD COLUMN "adminUnlockedUntil" TIMESTAMP(3);
