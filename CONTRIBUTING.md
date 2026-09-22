# Contributing

Thanks for helping improve the platform. This project aims to stay easy to self-host and honest
about what it does.

## Ground rules

- **No stealth tracking.** Features that hide tracking from the technician, capture unrelated
  data, or run without the visible notification will not be accepted.
- **No hard-coded company names, domains, logos, or URLs.** All branding is runtime configuration.
- **Never commit secrets** — no `.env`, keys, certificates, tokens, or production URLs.
- **Multi-tenant safety first.** Every new query and endpoint must respect organization scoping.
- **No placeholder implementations.** Do not merge features that only simulate GPS or stub out
  required behaviour.

## Getting started

```bash
# Backend
cd backend && npm install
cp ../.env.example .env      # point DATABASE_URL at a local PostgreSQL
npx prisma migrate deploy
npm run dev

# Frontend
cd frontend && npm install
VITE_API_URL=http://localhost:4000 npm run dev
```

Easiest full-stack route: `cp .env.example .env && docker compose up -d --build`.

## Before opening a pull request

```bash
cd backend  && npm test && npx tsc --noEmit
cd frontend && npx tsc --noEmit && npm run build
```

For API changes, also run the acceptance test against a running stack:

```bash
bash scripts/e2e-api.sh
```

## Code style

- TypeScript strict mode; no `any` in new code without a comment explaining why.
- Validate every request body with Zod; return meaningful error messages.
- Keep modules domain-oriented (`backend/src/modules/<domain>.ts`); avoid one large file.
- Frontend: reusable components in `src/components`, one page per file in `src/pages`,
  shared logic in `src/lib` and `src/state`.
- Android: services/repositories per concern, as in the existing `android/app/src/main/java/...`.
- Prefer explicit, readable code over clever compact code in new contributions.

## Database changes

- Add a migration under `backend/prisma/migrations/<timestamp>_<name>/migration.sql`.
- Never edit an applied migration or the production schema by hand.
- Add indexes for new query patterns, especially anything filtering by organization or time.
- Do not seed fake production data; development seeds belong in `backend/prisma/seed.ts` and must
  stay clearly labelled as demo data.

## Commits and pull requests

- Describe the *why*, not just the *what*.
- Keep pull requests focused; split unrelated changes.
- Include tests for new logic: GPS math, trip detection, authorization, and organization isolation
  are the highest-value areas.
- Note any manual verification you performed, especially on real Android hardware.

## Reporting bugs

Include the version (`GET /health/version`), deployment method (Docker or local), reproduction
steps, and relevant logs (`docker compose logs backend`). Redact secrets and personal location data.

## Security

Report vulnerabilities privately per [SECURITY.md](SECURITY.md), never in a public issue.
