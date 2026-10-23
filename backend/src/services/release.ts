import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { config } from '../config';

/**
 * The build currently published at /tracker.apk.
 *
 * `versionName`/`versionCode` come from the sidecar that `scripts/publish-apk.sh`
 * writes from the APK's own aapt2 badging — never from the server's VERSION file.
 * The two are kept in step by the release scripts, but VERSION can legitimately be
 * ahead of the APK (bumping the version before building), and Android refuses an
 * install whose versionCode is not higher than the installed one. The APK is the
 * only honest answer to "what can this phone actually install?".
 */
export type Release = {
  versionName: string;
  versionCode: number;
  sizeBytes: number;
  sha256: string;
  downloadPath: string;
};

/** nginx serves the published APK at this path, unrelated to the /api prefix. */
const DOWNLOAD_PATH = '/tracker.apk';

const sidecarSchema = z.object({
  versionName: z.string().min(1).max(40),
  versionCode: z.number().int().positive(),
});

/**
 * Hashes are cached by path + mtime + size, so a long-running backend hashes a
 * ~20 MB APK once per publish rather than once per phone update check.
 */
const hashCache = new Map<string, string>();

function sha256Of(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Read the published release, or `null` when nothing updatable is published.
 *
 * A missing APK, missing sidecar, or invalid sidecar all mean "no update to offer",
 * never an error: a fresh clone has no ./apk, and an older deployment published
 * before the sidecar existed. Neither should make phones show a failure.
 */
export async function readRelease(apkDir: string = config.apkDir): Promise<Release | null> {
  const apkPath = join(apkDir, 'tracker.apk');

  let info;
  try {
    info = await stat(apkPath);
  } catch {
    return null;
  }
  if (!info.isFile() || info.size === 0) return null;

  let raw: string;
  try {
    raw = await readFile(`${apkPath}.json`, 'utf8');
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = sidecarSchema.safeParse(JSON.parse(raw));
  } catch {
    return null;
  }
  if (!parsed.success) return null;

  // Keyed by the file identity, so republishing invalidates the cached hash.
  const cacheKey = `${apkPath}:${info.mtimeMs}:${info.size}`;
  let sha256 = hashCache.get(cacheKey);
  if (!sha256) {
    sha256 = await sha256Of(apkPath);
    for (const key of hashCache.keys()) {
      if (key.startsWith(`${apkPath}:`)) hashCache.delete(key);
    }
    hashCache.set(cacheKey, sha256);
  }

  return {
    versionName: parsed.data.versionName,
    versionCode: parsed.data.versionCode,
    sizeBytes: info.size,
    sha256,
    downloadPath: DOWNLOAD_PATH,
  };
}

export type AuthorizationResult =
  | { ok: true; release: Release }
  | { ok: false; status: 403 | 404 | 409; error: string };

/**
 * Decide whether this device may install this release.
 *
 * `adminUnlockedUntil` is set by /api/device/verify-admin after the device admin
 * password is checked against the server's bcrypt hash, so this is where the
 * "an administrator must approve the update" rule actually lives. It is checked
 * before anything else, so an unverified phone never learns whether a build is
 * published. The versionCode comparison is not a formality either: an admin must
 * never authorize the install of a build that was replaced between the check and
 * the tap.
 */
export function authorizeUpdate(
  release: Release | null,
  device: { adminUnlockedUntil: Date | null },
  requestedVersionCode: number,
  now: number = Date.now(),
): AuthorizationResult {
  if (!device.adminUnlockedUntil || device.adminUnlockedUntil.getTime() <= now) {
    return { ok: false, status: 403, error: 'Admin verification required' };
  }
  if (!release) {
    return { ok: false, status: 404, error: 'No updatable release is published' };
  }
  if (requestedVersionCode !== release.versionCode) {
    return { ok: false, status: 409, error: 'The published release changed; check for updates again' };
  }
  return { ok: true, release };
}
