import { Router } from 'express';
import { auth } from '../auth';
import { asyncHandler } from '../common';
import { readRelease } from '../services/release';

export const releasesRouter = Router();

/**
 * The build currently published at /tracker.apk, for the dashboard's Android
 * setup guide. `release: null` means nothing is published yet (a fresh clone, or
 * an APK copied in without its sidecar) — that is a normal state, not an error.
 *
 * Any signed-in user may read it: the version is already public in the APK
 * served at /tracker.apk, and the guide is shown to admins of every level.
 */
releasesRouter.get('/api/releases/current', auth, asyncHandler(async (_req, res) => {
  res.json({ release: await readRelease() });
}));
