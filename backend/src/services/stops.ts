import { effectiveSpeed, haversine, RawQualityPoint, flagOutliers } from './geo';

export type DetectedStop = {
  latitude: number;
  longitude: number;
  arrivedAt: Date;
  /** null = still stopped at the end of the point stream. */
  departedAt: Date | null;
  durationSeconds: number;
  pointCount: number;
};

export type DetectStopsOptions = {
  /** Minimum still-time before a stationary run counts as a stop. */
  minStopSeconds?: number;
  /** Points within this radius belong to the same place. */
  clusterRadiusMeters?: number;
  /** Two nearby stops separated by no more than this gap merge into one record. */
  mergeGapSeconds?: number;
  movementThresholdMps?: number;
};

function centroidOf(points: Array<{ latitude: number; longitude: number }>): { latitude: number; longitude: number } {
  const total = points.reduce(
    (acc, point) => ({ latitude: acc.latitude + point.latitude, longitude: acc.longitude + point.longitude }),
    { latitude: 0, longitude: 0 },
  );
  return { latitude: total.latitude / points.length, longitude: total.longitude / points.length };
}

/**
 * Find every place where the device was motionless for at least `minStopSeconds`,
 * whether or not a trip is active — this is what captures overnight, depot and
 * pre-shift dwell that trip detection discards.
 *
 * Stationary runs are found with the same movement test trip detection uses,
 * then nearby+recent stops merge so one physical place yields one record with
 * the total time spent there.
 */
export function detectStops(points: RawQualityPoint[], options: DetectStopsOptions = {}): DetectedStop[] {
  const minStopSeconds = options.minStopSeconds ?? 300;
  const clusterRadiusMeters = options.clusterRadiusMeters ?? 50;
  const mergeGapSeconds = options.mergeGapSeconds ?? 600;
  const movementThresholdMps = options.movementThresholdMps ?? 1.4;

  const ordered = [...points].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  if (ordered.length < 2) return [];

  const flagged = flagOutliers(ordered);
  const n = flagged.length;
  const moving: boolean[] = new Array(n).fill(false);
  let lastValidIndex = -1;
  let previousValid = -1;

  for (let i = 0; i < n; i += 1) {
    if (flagged[i].outlier) continue;
    lastValidIndex = i;
    // Compare against the last good fix, not the raw previous index — a bad fix
    // in the middle of a park must not split the stationary run.
    if (previousValid >= 0) {
      const previous = flagged[previousValid];
      const current = flagged[i];
      const seconds = (current.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000;
      const derived = seconds > 0 ? haversine(previous, current) / seconds : 0;
      const reported = effectiveSpeed(current, previous, current) / 3.6;
      moving[i] = Math.max(derived, reported) >= movementThresholdMps;
    }
    previousValid = i;
  }
  if (lastValidIndex < 0) return [];

  const runs: Array<{ start: number; end: number }> = [];
  let runStart = -1;
  for (let i = 0; i <= lastValidIndex; i += 1) {
    if (flagged[i].outlier) continue;
    if (moving[i]) {
      if (runStart >= 0) {
        runs.push({ start: runStart, end: i - 1 });
        runStart = -1;
      }
      continue;
    }
    if (runStart < 0) runStart = i;
  }
  if (runStart >= 0) runs.push({ start: runStart, end: lastValidIndex });

  const stops: DetectedStop[] = [];
  for (const run of runs) {
    const slice = flagged.slice(run.start, run.end + 1).filter((point) => !point.outlier);
    if (slice.length < 2) continue;
    const arrivedAt = slice[0].recordedAt;
    const lastAt = slice[slice.length - 1].recordedAt;
    const durationSeconds = Math.round((lastAt.getTime() - arrivedAt.getTime()) / 1000);
    if (durationSeconds < minStopSeconds) continue;
    stops.push({
      ...centroidOf(slice),
      arrivedAt,
      // A run reaching the end of the stream is either "still stopped" or where
      // the lookback window cut off; leave it open so the next recompute extends it.
      departedAt: run.end === lastValidIndex ? null : lastAt,
      durationSeconds,
      pointCount: slice.length,
    });
  }

  return mergeNearby(stops, clusterRadiusMeters, mergeGapSeconds);
}

function mergeNearby(stops: DetectedStop[], clusterRadiusMeters: number, mergeGapSeconds: number): DetectedStop[] {
  const merged: DetectedStop[] = [];
  for (const stop of stops) {
    const previous = merged[merged.length - 1];
    if (previous && previous.departedAt !== null) {
      const gapSeconds = (stop.arrivedAt.getTime() - previous.departedAt.getTime()) / 1000;
      if (gapSeconds <= mergeGapSeconds && haversine(previous, stop) <= clusterRadiusMeters) {
        const totalPoints = previous.pointCount + stop.pointCount;
        previous.departedAt = stop.departedAt;
        previous.durationSeconds += stop.durationSeconds;
        previous.pointCount = totalPoints;
        const share = stop.pointCount / Math.max(1, totalPoints);
        previous.latitude += (stop.latitude - previous.latitude) * share;
        previous.longitude += (stop.longitude - previous.longitude) * share;
        continue;
      }
    }
    merged.push({ ...stop });
  }
  return merged;
}
