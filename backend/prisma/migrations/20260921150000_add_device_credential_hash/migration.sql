-- AlterTable
ALTER TABLE "Device" ADD COLUMN "credentialHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Device_credentialHash_key" ON "Device"("credentialHash");
