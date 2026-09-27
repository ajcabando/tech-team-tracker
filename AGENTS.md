# Tracker — Agent Instructions

Self-hosted, multi-tenant GPS tracking platform. Android foreground service → Express/Prisma API → React dashboard, all behind Docker Compose.

## Quick commands

```bash
# Full stack (recommended starting point)
cp .env.example .env   # set POSTGRES_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET
docker compose up -d --build

# Backend only
cd backend && npm install
npx prisma migrate deploy   # or: npx prisma generate (after schema change)
npm run dev                 # tsx watch on :4000

# Frontend only (needs backend on :4000)
cd frontend && npm install
VITE_API_URL=http://localhost:4000 npm run dev   # vite on :5788

# Typecheck
cd backend  && npx tsc --noEmit
cd frontend && npx tsc --noEmit

# Test
cd backend && npm test                       # vitest — GPS math, trips, tokens
bash scripts/e2e-api.sh                      # curl-based, needs running stack + seeded admin
node scripts/e2e-browser.mjs                 # headless Chrome, needs CHROME_PATH if non-standard

# Mobile layout gate (see "Mobile layout is a gate, not a screenshot" below)
node scripts/audit-mobile-selftest.mjs        # proves the audit can still fail
node scripts/audit-mobile.mjs                 # 13 routes x 3 widths x 2 themes; exits 1 on any defect

# Android
# Open android/ in Android Studio (SDK 35, JDK 17) → Build → Make Project
# Emulator server URL: http://10.0.2.2:5789
# Do NOT put org.gradle.java.home in gradle.properties — it is committed and a
# machine-specific path breaks CI. Use JAVA_HOME, which Android Studio sets for
# itself from its bundled JBR.

# Database
docker compose exec postgres psql -U tracker -d tracker   # access PostgreSQL (not published to host)

# Release
./scripts/check-version.sh                                # version consistency, no build needed
./scripts/preflight-update.sh <apk> [--install]            # refuse an APK that would break a fleet
./scripts/publish-apk.sh <apk> --url https://your-server   # publish to ./apk → served at /tracker.apk
git tag v0.3.4 && git push --tags                         # CI builds the signed release
```

## Architecture

```
backend/src/
  server.ts          → bootstrap + listen
  app.ts             → Express app factory
  config.ts          → env vars (all config is env-driven)
  common.ts          → orgScope(), audit(), asyncHandler(), paginate()
  db.ts              → Prisma client singleton
  auth.ts            → JWT + device-token middleware
  modules/           → 14 domain routers (auth, setup, organizations, users,
                        technicians, devices, locations, trips, reports,
                        settings, dashboard, alerts, audit, health)
  services/          → geo.ts (GPS quality), trips.ts/tripEngine.ts (detection),
                        settings.ts, watchdog.ts (stale-device alerts)
  middleware/        → rateLimit.ts
  openapi.ts         → generated OpenAPI spec

frontend/src/
  pages/             → 13 pages (Dashboard, Login, Setup, Trips, Reports, Settings, ...)
  components/        → LiveMap.tsx (leaflet), ui.tsx (shared primitives)
  lib/api.ts         → fetch wrapper with token refresh
  lib/router.tsx     → client-side routing
  lib/format.ts      → display helpers
  state/auth.tsx     → auth context + token management

android/app/src/main/java/
  TrackingService.kt    → foreground service, adaptive GPS intervals
  TripDetector.kt       → on-device trip/stop mirror
  LocationEntity.kt     → Room DB (offline queue)
  SyncWorker.kt         → idempotent batch upload
  ui/                   → Jetpack Compose screens + design system

backend/prisma/
  schema.prisma         → data model (Organization → Technician → Device/Location/Trip)
  migrations/           → auto-applied on container start
  seed.ts               → dev-only demo data (npm run seed)
```

## Gotchas

- **Nginx proxies /api to backend** — in Docker, browser uses single origin (port 5788), no CORS needed. For local dev with separate processes, you MUST set `VITE_API_URL=http://localhost:4000`.
- **Two token types** — user JWT (dashboard sessions) vs device tokens (phone uploads). Device tokens can ONLY read config + upload locations; they are rejected from management endpoints. The e2e test asserts this isolation.
- **No default admin** — first-run setup wizard creates the superadmin, then permanently disables itself. There is no factory password. Use `npm run seed` only for dev.
- **PostgreSQL not published to host** — access via `docker compose exec postgres psql`, not localhost:5432.
- **Port mapping** — backend listens on 4000 internally, published as 5789 externally. Frontend nginx on 80 published as 5788.
- **orgScope()** in `backend/src/common.ts` handles multi-tenant isolation. Every database query that reads organization data MUST use it. Only SUPERADMIN sees across orgs.
- **Pairing codes** — single-use, 15-minute expiry, bcrypt-hashed at rest, scoped to one device UUID. Never store raw codes.
- **Prisma migrations** — auto-applied on container start. Never edit an applied migration by hand. Add new ones under `backend/prisma/migrations/<timestamp>_<name>/`.
- **Device removal is two-step** — API returns 409 while GPS history exists. Must pass `?purge=true` to erase. Technicians with history are unpaired+disabled instead of deleted.
- **SSE live stream** — `/api/dashboard/stream` must not be buffered by nginx (already configured). Corporate proxies may buffer SSE; dashboard falls back to 20s polling.
- **The containers serve plain HTTP by design** — TLS is terminated by a reverse proxy on another host. Do not add `listen 443` to `frontend/nginx.conf`; a deployment that terminates TLS in front of it is the intended topology.
- **`VERSION` at the repo root is the only version string** — the Android build reads it for `versionName`, the backend serves it at `/health/version` (bind-mounted into the container), and the dashboard fetches it. Never hardcode a version in `frontend/src`; `scripts/check-version.sh` fails the build if you do.
- **`android/gradle.properties` must never contain a machine path** — it is committed, so `org.gradle.java.home` pointing at your local Android Studio breaks CI. The JVM comes from the environment instead.
- **The release signing key is fleet-critical** — a phone can only be updated in place if the certificate and a higher `versionCode` match, and the only alternative is an uninstall, which erases the pairing *and* every unsynced GPS point (`allowBackup="false"`, so there is no backup). Never commit the keystore; use the Actions secrets. See `docs/signing.md`.
- **`scripts/preflight-update.sh` gates every release** — run it before publishing. It compares signing *certificates*, not file hashes: two builds of identical content differ byte-for-byte because of zip timestamps.
- **Room has no migrations registered** — `LocationDatabase` is built with no `addMigrations` and no `fallbackToDestructiveMigration`, so bumping `@Database(version = …)` without an explicit `Migration` crashes the app on every paired phone. `preflight-update.sh` checks for this.
- **A `location` foreground service needs `ACCESS_BACKGROUND_LOCATION`** — the failure is silent on Android 11-13 (service runs, notification shows, no location arrives) and a `SecurityException` on 14+. `BootReceiver` checks the grant before starting, and `TrackingService.promoteToForeground()` stops cleanly rather than crash-looping.
- **`BOOT_COMPLETED` may start a location FGS** — it is an explicit exemption, and `location` is not on Android 15's boot-receiver blocklist (`dataSync`, `camera`, `mediaPlayback`, `phoneCall`, `mediaProjection`, `microphone`). `location` also has no runtime cap, unlike `dataSync`.
- **Nothing can be done about OEM battery killing from code** — Android's own Doze does not kill a location FGS, but Samsung/Xiaomi/Huawei layers do. It is handled by a one-time in-app prompt plus a per-manufacturer checklist on the Android setup page, and the real backstop is the server-side device-offline watchdog.
- **No API can disable the mobile hotspot** — `WifiManager.setWifiApEnabled` is `@hide` at every API level and there is no DPM policy for tethering. Only Device Owner can do it, which the project does not use. Do not attempt reflection.
- **Mobile layout is a gate, not a screenshot** — `scripts/audit-mobile.mjs` walks 13 routes at 360/390/430px in both themes, at every scroll offset, and fails on `overlap` (text painted over text), `occluded` (a sticky bar swallowed by the sticky header), `overflow` (content wider than its box or past the viewport), `scroll-clip`, and `tap` targets under 40px. It exits 1. Run it after any change to `styles.css` or to a page's markup.
- **The mobile audit is meaningless without hostile data** — the bugs are caused by long *unbroken* tokens, and demo seed data has short realistic names. Load `scripts/audit-adversarial-data.sql` (120-char technician name, 80-char device name, 60-char employee number, uncapped email, 80-char company name — each at its real schema maximum) before auditing, and run `scripts/audit-adversarial-data-cleanup.sql` afterwards. It exits 1.
- **Never trust a passing audit until the self-test passes** — `scripts/audit-mobile-selftest.mjs` injects each original bug back as a stylesheet and asserts the detectors still fire, and first asserts the page is clean. A detector weakened into silence would otherwise make the layout audit pass forever.
- **Two sticky bars cannot share `top: 0`** — `.mobile-header` and `.topbar` both were `position: sticky; top: 0`, so on a phone the topbar pinned underneath the opaque header and the search field became unreadable *and* untappable on every scrolled page. `.topbar` is `position: static` under 720px for that reason; do not make it sticky again.
- **Unbreakable values need `overflow-wrap: anywhere`, never `break-word`** — only `anywhere` shrinks min-content, and a flex item's `min-width: auto` *is* its min-content. A 120-char technician name in a `break-word` heading still refuses to shrink and widens the whole page to ~1975px on a 390px screen.
- **A single-file bind mount becomes a directory under Colima** — `docker-compose.yml` bind-mounts `./VERSION` to `/app/VERSION`, which works on Docker Desktop but silently creates a directory under Colima, so `/health/version` returns `{"version":"unknown"}` and the UI shows "Build vunknown". Set `APP_VERSION` in `.env` (loaded via `env_file`) to work around it.

## Code conventions

- TypeScript strict mode. No `any` without a comment explaining why.
- Zod validation on every request body — return meaningful error messages.
- Domain-oriented modules (`backend/src/modules/<domain>.ts`), not one large file.
- Frontend: one page per file in `src/pages/`, reusable components in `src/components/`.
- Android: services/repositories per concern, Jetpack Compose with custom design system (`ui/Theme.kt`, `ui/Components.kt`, `ui/TrackerIcons.kt`).
- Prefer explicit, readable code over clever compact code.

## Key files for common tasks

| Task | File(s) |
| --- | --- |
| Add a new API endpoint | `backend/src/modules/<domain>.ts`, register in `app.ts` |
| Change data model | `backend/prisma/schema.prisma` → `npx prisma migrate dev` |
| Add a new page | `frontend/src/pages/NewPage.tsx`, add route in `lib/router.tsx` |
| Modify GPS quality logic | `backend/src/services/geo.ts` |
| Modify trip detection | `backend/src/services/tripEngine.ts`, `trips.ts` |
| Change auth flow | `backend/src/auth.ts`, `frontend/src/state/auth.tsx` |
| Change Android tracking | `android/app/src/main/java/.../TrackingService.kt` |
| Change boot behaviour / permissions | `android/app/src/main/java/.../BootReceiver.kt`, `MainActivity.kt` |
| Cut a release | `VERSION` → `git tag v*` → CI, or `scripts/publish-apk.sh` |
| Change what's published on the dashboard | `VERSION` + `frontend/src/lib/api.ts` (`useReleaseVersion`) |
| Change stale-device alerting | `backend/src/services/watchdog.ts` |
| Modify live map | `frontend/src/components/LiveMap.tsx` |
| Change rate limits | `backend/src/middleware/rateLimit.ts` |
