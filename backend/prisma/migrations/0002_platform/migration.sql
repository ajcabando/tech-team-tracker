-- Extend the platform: organization status, system bootstrap state, refresh tokens,
-- tracking/retention settings, trip aggregates/stops, and alerts.

CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE','DISABLED');
CREATE TYPE "TripSource" AS ENUM ('AUTO','MANUAL');
CREATE TYPE "AlertSeverity" AS ENUM ('INFO','WARNING','CRITICAL');

ALTER TABLE "Organization" ADD COLUMN "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE "SystemState"(
  "id" TEXT NOT NULL,
  "initialized" BOOLEAN NOT NULL DEFAULT false,
  "initializedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SystemState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefreshToken"(
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Device" ADD COLUMN "unpairedAt" TIMESTAMP(3);

ALTER TABLE "Trip" ADD COLUMN "source" "TripSource" NOT NULL DEFAULT 'AUTO';
ALTER TABLE "Trip" ADD COLUMN "stopCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Trip" ADD COLUMN "longestStopSeconds" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Trip" ADD COLUMN "pointCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Trip" ADD COLUMN "mapMatchedRoute" JSONB;
CREATE INDEX "Trip_technicianId_startedAt_idx" ON "Trip"("technicianId","startedAt");

CREATE TABLE "TripStop"(
  "id" TEXT NOT NULL,
  "tripId" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "arrivedAt" TIMESTAMP(3) NOT NULL,
  "departedAt" TIMESTAMP(3),
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "TripStop_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TripStop_tripId_idx" ON "TripStop"("tripId");
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TrackingSetting"(
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "movingIntervalSeconds" INTEGER NOT NULL DEFAULT 5,
  "walkingIntervalSeconds" INTEGER NOT NULL DEFAULT 20,
  "stationaryIntervalSeconds" INTEGER NOT NULL DEFAULT 45,
  "lowBatteryIntervalSeconds" INTEGER NOT NULL DEFAULT 90,
  "stopTimeoutSeconds" INTEGER NOT NULL DEFAULT 300,
  "automaticTripDetection" BOOLEAN NOT NULL DEFAULT true,
  "gpsAccuracyThresholdMeters" DOUBLE PRECISION NOT NULL DEFAULT 100,
  "lowBatteryThreshold" INTEGER NOT NULL DEFAULT 20,
  CONSTRAINT "TrackingSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TrackingSetting_organizationId_key" ON "TrackingSetting"("organizationId");
ALTER TABLE "TrackingSetting" ADD CONSTRAINT "TrackingSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "RetentionSetting"(
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "rawLocationDays" INTEGER NOT NULL DEFAULT 90,
  "tripDays" INTEGER NOT NULL DEFAULT 730,
  "auditLogDays" INTEGER NOT NULL DEFAULT 365,
  CONSTRAINT "RetentionSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RetentionSetting_organizationId_key" ON "RetentionSetting"("organizationId");
ALTER TABLE "RetentionSetting" ADD CONSTRAINT "RetentionSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Alert"(
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "technicianId" TEXT,
  "deviceId" TEXT,
  "type" TEXT NOT NULL,
  "severity" "AlertSeverity" NOT NULL DEFAULT 'WARNING',
  "message" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Alert_organizationId_createdAt_idx" ON "Alert"("organizationId","createdAt");
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
