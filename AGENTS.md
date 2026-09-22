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

# Android
# Open android/ in Android Studio (SDK 35, JDK 17) → Build → Make Project
# Emulator server URL: http://10.0.2.2:5789

# Database
docker compose exec postgres psql -U tracker -d tracker   # access PostgreSQL (not published to host)
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
                        settings.ts
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
| Modify live map | `frontend/src/components/LiveMap.tsx` |
| Change rate limits | `backend/src/middleware/rateLimit.ts` |
