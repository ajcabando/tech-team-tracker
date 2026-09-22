# Privacy and transparent tracking

This platform tracks people. Location data is personal data, and in many jurisdictions tracking
employees carries legal obligations. This document describes what the software does, what it
deliberately does **not** do, and what the deploying organization must decide.

## Principles

1. **Transparent by design.** The Android app shows a persistent `Tracking Active` notification
   whenever the foreground service is running. Technicians can see the current speed, GPS accuracy,
   battery level, and today's distance at any time.
2. **Technician-controllable.** Tracking can be stopped from the app's home screen or directly from
   the notification. Stopping it is not hidden and is visible to the technician.
3. **No stealth features.** This repository contains no hidden-tracking, remote-activation,
   screen-capture, or covert-surveillance capability. Pull requests adding them will be rejected.
4. **Purpose limitation.** The system is intended for authorized company tracking of company
   devices during work time — for example, dispatch, route history, and proof of service.

## What is collected per GPS point

| Field | Purpose |
| --- | --- |
| Latitude / longitude | Location history and live map |
| Timestamp | Ordering, trip detection, reporting |
| Speed | Moving/stopped status, trip statistics |
| Heading | Direction on the map |
| Accuracy | GPS quality filtering |
| Altitude | Route context |
| Battery level | Device health and low-battery alerts |
| Network state | Offline/sync diagnostics |
| Device ID, technician ID | Attribution to the correct technician |

Raw points are the authoritative record. Any future map-matched route is derived and stored
separately; raw data is never replaced by an approximated route.

## What the software does not collect

- No contacts, photos, microphone, camera, or installed-app list.
- No message or call content.
- No data outside the configured tracking service.
- No credentials are ever written to audit logs.

## Obligations for the deploying organization

You are the data controller. Before enabling tracking:

1. **Notify** technicians in writing and, where required, obtain consent or works-council agreement.
2. **Define the policy**: which roles are tracked, in which vehicles/devices, during which hours.
3. **Document the lawful basis** for processing (typically legitimate interest or contract), and
   complete a data protection impact assessment if tracking is systematic.
4. **Configure retention** (Settings → Data retention) to the shortest period that meets business
   needs. A background job deletes data older than the window daily.
5. **Limit access**: give dashboard accounts the least privilege that lets people do their job.
   Roles are `SUPERADMIN`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN`.
6. **Secure the data**: HTTPS only, strong secrets, restricted database access, encrypted off-host
   backups. See [DEPLOYMENT.md](DEPLOYMENT.md) and [BACKUP.md](BACKUP.md).
7. **Handle subject access requests.** A technician's history is available to administrators
   through the dashboard and API (`/api/technicians/:id/locations`, `/api/technicians/:id/trips`).

## Work schedules

Tracking is intended for work hours. The Android app lets the technician start and stop tracking
around their shift, and the organization can require tracking to be started at shift start. The
software does not silently begin tracking outside a shift: starting is always initiated on the
device and is always visible.

## Data location and third parties

The stack is self-hosted. The only external requests the default deployment makes are:

- **Map tiles** from `tile.openstreetmap.org` when a dashboard map or the Android map is displayed.
  Review the OpenStreetMap tile usage policy and consider a self-hosted tile server or a commercial
  provider for production or high traffic.
- Fonts from Google Fonts in the dashboard stylesheet (optional; remove the `@import` for a fully
  offline deployment).

No analytics, advertising, or tracking SDKs are included.

## Retention defaults

| Data | Default retention |
| --- | --- |
| Raw GPS points | 90 days |
| Trips | 730 days |
| Audit logs | 365 days |

Adjust in Settings → Data retention, and make sure the periods match what you told your technicians
and what your policy/regulator requires.
