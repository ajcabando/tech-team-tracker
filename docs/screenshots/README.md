# Screenshots

The README gallery links to the PNG files below. Regenerate them any time with the
automated capture script — no manual screenshotting needed.

## Automated capture (recommended)

1. Start an **isolated scratch stack** so demo data never touches production:
   ```bash
   API_PORT=5797 FRONTEND_PORT=5796 docker compose -p ttshots up -d --build
   ```
2. Seed the owner account, then the fictional demo fleet (Austin, TX — clearly sample data):
   ```bash
   docker compose -p ttshots exec backend npm run seed
   docker compose -p ttshots exec backend npm run seed:shots
   ```
   `seed:shots` (`backend/prisma/shot-seed.ts`, dev-only) creates 3 technicians, 3 paired
   devices, recent GPS routes, 2 trips, alerts, and audit entries. Never run it on production.
3. Capture (needs Chrome; set `CHROME_PATH` if it is not in a standard location):
   ```bash
   DASHBOARD_URL=http://localhost:5796 node scripts/capture-screenshots.mjs
   ```
   This signs in as the seeded owner, walks every page at 1440×900 plus the mobile set at
   390×844, and writes the PNGs into this directory with the exact names the README uses.
4. Tear down the scratch stack: `docker compose -p ttshots down`

## Required captures

| File | Screen |
| --- | --- |
| `01-login.png` | Sign-in page with branding |
| `02-dashboard.png` | Dashboard: summary cards + live map |
| `03-live-map.png` | Map scrolled into view with technician markers |
| `04-technicians.png` | Technician list with status badges |
| `05-devices.png` | Device health table |
| `06-trip-history.png` | Trip history with filters |
| `07-trip-details.png` | A trip with route map, stops, and statistics |
| `08-route-replay.png` | Replay player mid-playback with the marker on the route |
| `09-daily-report.png` | Daily report totals and per-technician table |
| `10-setup-guide.png` | Android setup guide with phone illustrations |
| `11-about.png` | About page with APK download card |
| `12-settings.png` | Settings: branding/tracking/retention |
| `13-superadmin.png` | System administration, Users tab |
| `mobile-dashboard.png` | Dashboard at 390×844 |
| `mobile-live-map.png` | Live map at 390×844 |
| `mobile-setup-guide.png` | Setup guide at 390×844 |

## Guidelines

- Screenshots must show **fictional demo data only** — no real people, customer addresses,
  or private infrastructure URLs. The `seed:shots` fleet uses `example.com` identities.
- Device `lastSeen` timestamps age out of the 5-minute online window quickly; re-run
  `seed:shots` (or touch up `lastSeen`) immediately before capturing so the fleet shows online.
- Keep file sizes reasonable (compress PNGs); target well under 500 KB each.
- Do not include tokens, real server URLs, or console output with secrets.
