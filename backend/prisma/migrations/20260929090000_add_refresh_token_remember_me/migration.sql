-- Remember-me session tier. Purely additive: existing rows default to the
-- ordinary tier, so nobody is signed out by this deploy and no existing
-- expiry is rewritten.
ALTER TABLE "RefreshToken" ADD COLUMN "rememberMe" BOOLEAN NOT NULL DEFAULT false;
