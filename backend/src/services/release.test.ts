import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authorizeUpdate, readRelease, type Release } from './release';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tracker-release-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const APK = Buffer.from('pretend these are APK bytes');
const APK_SHA = createHash('sha256').update(APK).digest('hex');

async function publish(options: { bytes?: Buffer; sidecar?: unknown | null } = {}): Promise<void> {
  const bytes = options.bytes ?? APK;
  await writeFile(join(dir, 'tracker.apk'), bytes);
  if (options.sidecar === null) return;
  const sidecar = options.sidecar === undefined ? { versionName: '0.3.6', versionCode: 9 } : options.sidecar;
  await writeFile(join(dir, 'tracker.apk.json'), typeof sidecar === 'string' ? sidecar : JSON.stringify(sidecar));
}

const release: Release = {
  versionName: '0.3.6',
  versionCode: 9,
  sizeBytes: 12,
  sha256: APK_SHA,
  downloadPath: '/tracker.apk',
};

describe('readRelease', () => {
  it('reports the published version with the hash of the served bytes', async () => {
    await publish();

    await expect(readRelease(dir)).resolves.toEqual({
      versionName: '0.3.6',
      versionCode: 9,
      sizeBytes: APK.length,
      sha256: APK_SHA,
      downloadPath: '/tracker.apk',
    });
  });

  it('returns null when no APK is published, so a fresh install is quiet', async () => {
    await expect(readRelease(dir)).resolves.toBeNull();
  });

  it('returns null without the sidecar rather than guessing a versionCode', async () => {
    await publish({ sidecar: null });
    await expect(readRelease(dir)).resolves.toBeNull();
  });

  it('returns null for malformed or incomplete sidecars', async () => {
    await publish({ sidecar: '{not json' });
    await expect(readRelease(dir)).resolves.toBeNull();

    await publish({ sidecar: { versionName: '0.3.6', versionCode: 0 } });
    await expect(readRelease(dir)).resolves.toBeNull();

    await publish({ sidecar: { versionCode: 9 } });
    await expect(readRelease(dir)).resolves.toBeNull();
  });

  it('recomputes the hash after a republish', async () => {
    await publish();
    const first = await readRelease(dir);

    const changed = Buffer.from('a different build, with a different length');
    await publish({ bytes: changed });
    const second = await readRelease(dir);

    expect(second?.sha256).toBe(createHash('sha256').update(changed).digest('hex'));
    expect(second?.sizeBytes).toBe(changed.length);
    expect(first?.sha256).not.toBe(second?.sha256);
  });
});

describe('authorizeUpdate', () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 1_000);

  it('refuses when the admin has not verified this phone', () => {
    expect(authorizeUpdate(release, { adminUnlockedUntil: null }, 9)).toEqual({
      ok: false,
      status: 403,
      error: 'Admin verification required',
    });
  });

  it('refuses once the five-minute unlock window has lapsed', () => {
    expect(authorizeUpdate(release, { adminUnlockedUntil: past }, 9)).toEqual({
      ok: false,
      status: 403,
      error: 'Admin verification required',
    });
  });

  it('checks the admin window before the version, so a stale build never leaks through', () => {
    expect(authorizeUpdate(release, { adminUnlockedUntil: past }, 8).ok).toBe(false);
  });

  it('refuses a build that was replaced between the check and the tap', () => {
    expect(authorizeUpdate(release, { adminUnlockedUntil: future }, 8)).toEqual({
      ok: false,
      status: 409,
      error: 'The published release changed; check for updates again',
    });
  });

  it('does not reveal whether a build is published before the admin verifies', () => {
    expect(authorizeUpdate(null, { adminUnlockedUntil: null }, 9)).toEqual({
      ok: false,
      status: 403,
      error: 'Admin verification required',
    });
  });

  it('reports an empty release list only to a verified admin', () => {
    expect(authorizeUpdate(null, { adminUnlockedUntil: future }, 9)).toEqual({
      ok: false,
      status: 404,
      error: 'No updatable release is published',
    });
  });

  it('allows the published build while the unlock window is live', () => {
    expect(authorizeUpdate(release, { adminUnlockedUntil: future }, 9)).toEqual({ ok: true, release });
  });
});
