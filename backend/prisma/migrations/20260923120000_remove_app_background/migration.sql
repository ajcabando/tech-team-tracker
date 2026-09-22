-- Drop the immersive app background feature (removed from UI/API).
ALTER TABLE "Branding" DROP COLUMN IF EXISTS "appBackgroundUrl";
