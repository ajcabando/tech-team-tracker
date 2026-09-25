-- Motionless ("dwell") stop records: places where a technician was still,
-- detected from raw GPS points regardless of trip boundaries.
ALTER TABLE "TrackingSetting" ADD COLUMN "stopClusterRadiusMeters" INTEGER NOT NULL DEFAULT 50;

CREATE TABLE "DwellStop"(
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "technicianId" TEXT NOT NULL,
  "deviceId" TEXT,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "arrivedAt" TIMESTAMP(3) NOT NULL,
  "departedAt" TIMESTAMP(3),
  "durationSeconds" INTEGER NOT NULL DEFAULT 0,
  "pointCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DwellStop_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DwellStop_organizationId_arrivedAt_idx" ON "DwellStop"("organizationId","arrivedAt");
CREATE INDEX "DwellStop_technicianId_arrivedAt_idx" ON "DwellStop"("technicianId","arrivedAt");
ALTER TABLE "DwellStop" ADD CONSTRAINT "DwellStop_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DwellStop" ADD CONSTRAINT "DwellStop_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "Technician"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill from already-recorded trip stops so existing history shows up immediately.
-- Trips under the detection threshold are skipped; terminal stops (departedAt null)
-- inherit the trip end so they are not treated as still-open today.
INSERT INTO "DwellStop"("id", "organizationId", "technicianId", "deviceId", "latitude", "longitude", "arrivedAt", "departedAt", "durationSeconds", "pointCount", "createdAt")
SELECT gen_random_uuid()::text, t."organizationId", t."technicianId", t."deviceId", s."latitude", s."longitude", s."arrivedAt",
       COALESCE(s."departedAt", t."endedAt"), s."durationSeconds", 0, now()
FROM "TripStop" s
JOIN "Trip" t ON t."id" = s."tripId"
WHERE s."durationSeconds" >= 300;
