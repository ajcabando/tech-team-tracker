import { db } from '../db';
import { publish } from '../realtime';

/**
 * Watches for paired phones that have stopped reporting.
 *
 * Every other alert in this system is raised *because* a phone uploaded
 * something, which means the one failure that matters most — a device that has
 * gone silent — raises nothing at all. A tracker killed by the OS, stripped of
 * its permissions, or simply switched off looks identical to a healthy idle
 * phone: the dashboard's "offline" figure is a display-time count, not an event,
 * and nobody is told.
 *
 * The fix has to live on the server. The phone cannot report that it has died,
 * and once it has, nothing in the app can notice.
 *
 * Silence is not proof of a fault, so the rule is deliberately conservative: a
 * device is only eligible if it was demonstrably working recently, and each one
 * is reported at most once per dedupe window. A phone switched off for the
 * weekend must not raise an alert every fifteen minutes.
 */

/** The subset of a device the watchdog needs to judge it. */
export type WatchedDevice = {
  id: string;
  organizationId: string;
  technicianId: string | null;
  deviceName: string;
  lastSeen: Date | null;
  updatedAt: Date;
  status: string;
  unpairedAt: Date | null;
};

export const WATCHDOG_DEFAULTS = {
  /** Silent for longer than this and the device is considered gone missing. */
  silenceMs: intMinutes('WATCHDOG_SILENCE_MINUTES', 30),
  /** Only devices seen within this window are eligible at all. */
  eligibleMs: intMinutes('WATCHDOG_ELIGIBLE_DAYS', 7) * 24 * 60,
  /** Re-report the same device at most this often. */
  dedupeMs: intMinutes('WATCHDOG_DEDUPE_HOURS', 6) * 60,
  /** How often the scan runs. */
  intervalMs: intMinutes('WATCHDOG_INTERVAL_MINUTES', 15),
};

function intMinutes(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return (Number.isFinite(parsed) && parsed > 0 ? parsed : fallback) * 60 * 1000;
}

/** Human phrasing for a duration, e.g. "3h 20m". */
export function describeSilence(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

/**
 * The whole rule, in one place, so it can be read and tested without a database.
 *
 * `lastSeen` is null only for a device that has been active but never uploaded;
 * `updatedAt` stands in for it, since a status change is then the only signal
 * that anything ever happened.
 */
export function isMissing(
  device: WatchedDevice,
  now: Date,
  thresholds: { silenceMs: number; eligibleMs: number } = WATCHDOG_DEFAULTS,
): boolean {
  // ACTIVE means the phone authenticated and was put in service, so silence is a
  // regression rather than a device that never came up. An unpaired device is
  // supposed to be silent.
  if (device.status !== 'ACTIVE') return false;
  if (device.unpairedAt !== null) return false;

  const reference = device.lastSeen ?? device.updatedAt;
  const silentFor = now.getTime() - reference.getTime();

  // Long gone: retired, or genuinely off for weeks. Not actionable.
  if (silentFor > thresholds.eligibleMs) return false;

  return silentFor >= thresholds.silenceMs;
}

/**
 * One pass. Exported so it can be triggered directly by a test or an admin
 * endpoint rather than only by the timer.
 */
export async function runDeviceWatchdog(now = new Date()): Promise<number> {
  // The coarse filter is left to the database and the fine-grained rule to
  // [isMissing]. The query returns only ACTIVE, still-paired devices, and reads
  // six small columns, so this stays cheap even for a large fleet.
  const candidates = await db.device.findMany({
    where: { status: 'ACTIVE', unpairedAt: null },
    select: {
      id: true,
      organizationId: true,
      technicianId: true,
      deviceName: true,
      lastSeen: true,
      updatedAt: true,
      status: true,
      unpairedAt: true,
    },
  });

  const dedupeCutoff = new Date(now.getTime() - WATCHDOG_DEFAULTS.dedupeMs);
  let raised = 0;

  for (const device of candidates as WatchedDevice[]) {
    if (!isMissing(device, now)) continue;

    const recent = await db.alert.findFirst({
      where: { deviceId: device.id, type: 'DEVICE_OFFLINE', createdAt: { gte: dedupeCutoff } },
      select: { id: true },
    });
    if (recent) continue;

    const reference = device.lastSeen ?? device.updatedAt;
    const alert = await db.alert.create({
      data: {
        organizationId: device.organizationId,
        technicianId: device.technicianId,
        deviceId: device.id,
        type: 'DEVICE_OFFLINE',
        severity: 'WARNING',
        message: `${device.deviceName} has not reported for ${describeSilence(now.getTime() - reference.getTime())}`,
      },
    });
    publish({ type: 'alert', organizationId: device.organizationId, payload: alert });
    raised += 1;
  }

  return raised;
}

/**
 * Starts the periodic scan. The first pass is delayed rather than immediate so
 * it does not compete with startup, and `.unref()` keeps the timer from holding
 * the process open.
 */
export function scheduleDeviceWatchdog(): void {
  const run = async () => {
    try {
      const raised = await runDeviceWatchdog();
      if (raised > 0) console.log(`[watchdog] raised ${raised} device-offline alert(s)`);
    } catch (error) {
      // A failed scan must neither kill the interval nor take the process down:
      // the rest of the API has to keep serving.
      console.error('device-watchdog-failed', error);
    }
  };

  setTimeout(run, 30_000).unref();
  setInterval(run, WATCHDOG_DEFAULTS.intervalMs).unref();
  console.log(
    `[watchdog] scanning every ${WATCHDOG_DEFAULTS.intervalMs / 60_000} min, ` +
      `alerting after ${WATCHDOG_DEFAULTS.silenceMs / 60_000} min of silence`,
  );
}
