import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeSilence, isMissing, runDeviceWatchdog, type WatchedDevice } from './watchdog';

const findMany = vi.fn();
const findFirst = vi.fn();
const create = vi.fn();
const publish = vi.fn();

vi.mock('../db', () => ({
  db: {
    device: { findMany: (...args: unknown[]) => findMany(...args) },
    alert: { findFirst: (...args: unknown[]) => findFirst(...args), create: (...args: unknown[]) => create(...args) },
  },
}));
vi.mock('../realtime', () => ({ publish: (...args: unknown[]) => publish(...args) }));

const now = new Date('2026-09-27T12:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60_000);

function device(overrides: Partial<WatchedDevice> = {}): WatchedDevice {
  return {
    id: 'device-1',
    organizationId: 'org-1',
    technicianId: 'tech-1',
    deviceName: 'Pixel 7',
    lastSeen: minutesAgo(2),
    updatedAt: minutesAgo(2),
    status: 'ACTIVE',
    unpairedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
  findFirst.mockResolvedValue(null);
  create.mockImplementation((args: { data: Record<string, unknown> }) => ({ id: 'alert-1', ...args.data }));
});

describe('describeSilence', () => {
  it('reads in minutes below an hour', () => {
    expect(describeSilence(5 * 60_000)).toBe('5m');
  });

  it('reads in whole hours when exact', () => {
    expect(describeSilence(3 * 60 * 60_000)).toBe('3h');
  });

  it('splits hours and minutes otherwise', () => {
    expect(describeSilence((3 * 60 + 20) * 60_000)).toBe('3h 20m');
  });

  it('never reports less than a minute', () => {
    expect(describeSilence(1)).toBe('1m');
  });
});

describe('isMissing', () => {
  it('leaves a device that reported two minutes ago alone', () => {
    expect(isMissing(device(), now)).toBe(false);
  });

  it('flags a device silent past the threshold', () => {
    expect(isMissing(device({ lastSeen: minutesAgo(31) }), now)).toBe(true);
  });

  it('ignores a device that is not active', () => {
    expect(isMissing(device({ lastSeen: minutesAgo(600), status: 'PENDING' }), now)).toBe(false);
    expect(isMissing(device({ lastSeen: minutesAgo(600), status: 'DISABLED' }), now)).toBe(false);
  });

  it('ignores an unpaired device, which is silent by design', () => {
    expect(isMissing(device({ lastSeen: minutesAgo(600), unpairedAt: daysAgo(1) }), now)).toBe(false);
  });

  it('does not raise for a phone that has been off longer than the eligibility window', () => {
    // The distinction that stops a decommissioned device alerting forever.
    expect(isMissing(device({ lastSeen: daysAgo(30) }), now)).toBe(false);
  });

  it('still flags a phone silent just inside the eligibility window', () => {
    expect(isMissing(device({ lastSeen: daysAgo(2) }), now)).toBe(true);
  });

  it('falls back to updatedAt when a device has never uploaded', () => {
    const neverUploaded = device({ lastSeen: null, updatedAt: minutesAgo(45) });
    expect(isMissing(neverUploaded, now)).toBe(true);
  });

  it('honours overridden thresholds', () => {
    const strict = { silenceMs: 60_000, eligibleMs: 7 * 24 * 60 * 60_000 };
    expect(isMissing(device({ lastSeen: minutesAgo(5) }), now, strict)).toBe(true);
    expect(isMissing(device({ lastSeen: minutesAgo(5) }), now)).toBe(false);
  });
});

describe('runDeviceWatchdog', () => {
  it('raises an alert and pushes it to the dashboard', async () => {
    findMany.mockResolvedValue([device({ lastSeen: minutesAgo(45) })]);

    const raised = await runDeviceWatchdog(now);

    expect(raised).toBe(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'DEVICE_OFFLINE',
          severity: 'WARNING',
          deviceId: 'device-1',
          organizationId: 'org-1',
          technicianId: 'tech-1',
          message: 'Pixel 7 has not reported for 45m',
        }),
      }),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'alert', organizationId: 'org-1' }),
    );
  });

  it('stays quiet when every device is reporting', async () => {
    findMany.mockResolvedValue([device(), device({ id: 'device-2', lastSeen: minutesAgo(1) })]);

    expect(await runDeviceWatchdog(now)).toBe(0);
    expect(create).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('deduplicates so a silent device does not alert every scan', async () => {
    findMany.mockResolvedValue([device({ lastSeen: minutesAgo(45) })]);
    // An alert for this device already exists inside the dedupe window.
    findFirst.mockResolvedValue({ id: 'alert-earlier' });

    expect(await runDeviceWatchdog(now)).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  it('scopes the dedupe lookup to this device, this type, and the window', async () => {
    findMany.mockResolvedValue([device({ lastSeen: minutesAgo(45) })]);

    await runDeviceWatchdog(now);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deviceId: 'device-1', type: 'DEVICE_OFFLINE' }),
      }),
    );
  });

  it('handles a mixed fleet, raising only for the missing devices', async () => {
    findMany.mockResolvedValue([
      device({ id: 'healthy', lastSeen: minutesAgo(1) }),
      device({ id: 'missing', lastSeen: minutesAgo(90) }),
      device({ id: 'retired', lastSeen: daysAgo(60) }),
    ]);

    expect(await runDeviceWatchdog(now)).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].data.deviceId).toBe('missing');
  });

  it('carries a null technician through without failing', async () => {
    findMany.mockResolvedValue([device({ technicianId: null, lastSeen: minutesAgo(60) })]);

    expect(await runDeviceWatchdog(now)).toBe(1);
    expect(create.mock.calls[0][0].data.technicianId).toBeNull();
  });
});
