export type GeoPoint = { latitude: number; longitude: number };

const EARTH_RADIUS_M = 6371000;
const toRad = (value: number) => (value * Math.PI) / 180;

/** Great-circle distance in meters. */
export function haversine(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(x)));
}

export type RawQualityPoint = GeoPoint & { recordedAt: Date; accuracy?: number | null; speed?: number | null };

/** Anything above this accuracy radius (meters) is flagged rather than deleted. */
export const DEFAULT_ACCURACY_THRESHOLD = 100;

/** Upper bound for any road vehicle (km/h). Anything above is a bad fix. */
export const MAX_PLAUSIBLE_SPEED_KMH = 100;

/** If reported speed is much faster than geometry, trust geometry instead. */
export const REPORTED_VS_DERIVED_RATIO = 2;

export function classifyQuality(point: { accuracy?: number | null }, threshold = DEFAULT_ACCURACY_THRESHOLD): 'GOOD' | 'FAIR' | 'POOR' {
  if (point.accuracy == null) return 'GOOD';
  if (point.accuracy <= 30) return 'GOOD';
  if (point.accuracy <= threshold) return 'FAIR';
  return 'POOR';
}

/**
 * Mark physically impossible transitions (teleport jumps / impossible speed)
 * so the UI can ignore them while the raw record is preserved for audit.
 */
export function flagOutliers(points: RawQualityPoint[]): Array<RawQualityPoint & { quality: 'GOOD' | 'FAIR' | 'POOR'; outlier: boolean }> {
  return points.map((point, index) => {
    const base = classifyQuality(point);
    let outlier = false;
    // Device-reported speed spike (urban multipath) — same bar as geometry.
    if (point.speed != null && Number.isFinite(point.speed) && point.speed > 97 * 3.6) outlier = true;
    if (index > 0) {
      const previous = points[index - 1];
      const seconds = (point.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000;
      if (seconds > 0) {
        const metersPerSecond = haversine(previous, point) / seconds;
        // ~350 km/h is beyond any road vehicle; treat as a bad fix.
        if (metersPerSecond > 97) outlier = true;
      } else {
        outlier = true; // duplicate or non-monotonic timestamp
      }
    }
    return { ...point, quality: outlier ? 'POOR' : base, outlier };
  });
}

/**
 * Speeds are stored and reported in km/h across the platform. Prefer the
 * device-reported value when it is plausible; fall back to a derived value
 * from consecutive fixes for GPS multipath spikes.
 */
export function effectiveSpeed(point: { speed?: number | null }, previous?: { recordedAt: Date } & GeoPoint, current?: { recordedAt: Date } & GeoPoint): number {
  const derived =
    previous && current
      ? (() => {
          const seconds = (current.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000;
          if (seconds > 0) return Math.max(0, (haversine(previous, current) / seconds) * 3.6);
          return null;
        })()
      : null;

  const reported = point.speed != null && Number.isFinite(point.speed) ? Math.max(0, point.speed) : null;

  // Ceiling: reject reported speeds no road vehicle can hit in this fleet.
  if (reported != null && reported > MAX_PLAUSIBLE_SPEED_KMH) {
    return derived ?? 0;
  }

  // Dual-source: if reported is more than 2× geometry implies, trust geometry
  // (urban multipath often reports a spike under the hard ceiling).
  if (reported != null && derived != null && derived > 1 && reported > REPORTED_VS_DERIVED_RATIO * derived) {
    return derived;
  }

  if (reported != null) return reported;
  return derived ?? 0;
}

/** Device-reported speed arrives from Android in m/s; store consistently as km/h. */
export function metersPerSecondToKmh(value: number): number {
  return value * 3.6;
}
