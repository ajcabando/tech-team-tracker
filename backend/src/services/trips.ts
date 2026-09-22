import { effectiveSpeed, haversine, RawQualityPoint, flagOutliers } from './geo';

export type StopRecord = {
  latitude: number;
  longitude: number;
  arrivedAt: Date;
  departedAt: Date | null;
  durationSeconds: number;
};

export type DetectedTrip = {
  startedAt: Date;
  endedAt: Date;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number;
  endLongitude: number;
  distanceMeters: number;
  drivingSeconds: number;
  maxSpeed: number;
  averageSpeed: number;
  stopCount: number;
  longestStopSeconds: number;
  pointCount: number;
  stops: StopRecord[];
};

export type DetectOptions = {
  stopTimeoutSeconds?: number;
  minStopSeconds?: number;
  movementThresholdMps?: number;
};

/**
 * Split a chronological point stream into trips.
 *
 * A trip begins on the first movement after idleness and ends once the device has
 * stayed within a small radius for longer than `stopTimeoutSeconds`. Stops shorter
 * than the timeout are recorded as stops inside the trip.
 */
export function detectTrips(points: RawQualityPoint[], options: DetectOptions = {}): DetectedTrip[] {
  const stopTimeoutSeconds = options.stopTimeoutSeconds ?? 300;
  const minStopSeconds = options.minStopSeconds ?? 60;
  const movementThresholdMps = options.movementThresholdMps ?? 1.4;

  const ordered = [...points].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  if (ordered.length < 2) return [];

  const flagged = flagOutliers(ordered);
  const n = flagged.length;
  const moving: boolean[] = new Array(n).fill(false);
  const gapSeconds: number[] = new Array(n).fill(0);

  for (let i = 1; i < n; i += 1) {
    const previous = flagged[i - 1];
    const current = flagged[i];
    const seconds = (current.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000;
    gapSeconds[i] = Math.max(0, seconds);
    if (current.outlier) continue;
    const derived = seconds > 0 ? haversine(previous, current) / seconds : 0;
    // Stored speed is km/h; convert before comparing against the m/s threshold.
    const reported = (current.speed ?? 0) / 3.6;
    moving[i] = Math.max(derived, reported) >= movementThresholdMps;
  }

  const trips: DetectedTrip[] = [];
  let active = false;
  let startIndex = 0;
  let lastMovingIndex = 0;
  let stationaryStart = -1;
  let stops: StopRecord[] = [];

  const closeTrip = (endIndex: number, terminalStop: StopRecord | null) => {
    const slice = flagged.slice(startIndex, endIndex + 1).filter((point) => !point.outlier);
    if (slice.length < 2) {
      active = false;
      stops = [];
      stationaryStart = -1;
      return;
    }
    let distance = 0;
    let driving = 0;
    let maxSpeed = 0;
    const speeds: number[] = [];
    for (let i = 1; i < slice.length; i += 1) {
      const previous = slice[i - 1];
      const current = slice[i];
      const meters = haversine(previous, current);
      distance += meters;
      const speed = effectiveSpeed(current, previous, current);
      speeds.push(speed);
      maxSpeed = Math.max(maxSpeed, speed);
      const seconds = (current.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000;
      if (seconds > 0 && seconds < 3600) driving += seconds;
    }
    const allStops = terminalStop ? [...stops, terminalStop] : stops;
    trips.push({
      startedAt: slice[0].recordedAt,
      endedAt: slice[slice.length - 1].recordedAt,
      startLatitude: slice[0].latitude,
      startLongitude: slice[0].longitude,
      endLatitude: slice[slice.length - 1].latitude,
      endLongitude: slice[slice.length - 1].longitude,
      distanceMeters: distance,
      drivingSeconds: Math.round(driving),
      maxSpeed,
      averageSpeed: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0,
      stopCount: allStops.length,
      longestStopSeconds: allStops.reduce((max, stop) => Math.max(max, stop.durationSeconds), 0),
      pointCount: slice.length,
      stops: allStops,
    });
    active = false;
    stops = [];
    stationaryStart = -1;
  };

  for (let i = 0; i < n; i += 1) {
    if (flagged[i].outlier) continue;
    if (moving[i]) {
      if (!active) {
        active = true;
        // Include the stationary point immediately before the first movement so a
        // short two-fix trip still has a start location and non-zero distance.
        startIndex = i > 0 ? i - 1 : i;
        stops = [];
      }
      if (stationaryStart >= 0) {
        const duration = Math.round((flagged[i].recordedAt.getTime() - flagged[stationaryStart].recordedAt.getTime()) / 1000);
        if (duration >= minStopSeconds) {
          stops.push({
            latitude: flagged[stationaryStart].latitude,
            longitude: flagged[stationaryStart].longitude,
            arrivedAt: flagged[stationaryStart].recordedAt,
            departedAt: flagged[i].recordedAt,
            durationSeconds: duration,
          });
        }
        stationaryStart = -1;
      }
      lastMovingIndex = i;
      continue;
    }
    if (!active) continue;
    if (stationaryStart < 0) {
      stationaryStart = i;
      continue;
    }
    const idleSeconds = (flagged[i].recordedAt.getTime() - flagged[stationaryStart].recordedAt.getTime()) / 1000;
    if (idleSeconds >= stopTimeoutSeconds) {
      const duration = Math.round(idleSeconds);
      const terminal: StopRecord = {
        latitude: flagged[stationaryStart].latitude,
        longitude: flagged[stationaryStart].longitude,
        arrivedAt: flagged[stationaryStart].recordedAt,
        departedAt: null,
        durationSeconds: duration,
      };
      closeTrip(lastMovingIndex, terminal);
    }
  }

  if (active) closeTrip(lastMovingIndex, null);
  return trips.filter((trip) => trip.distanceMeters > 50);
}

/** Total distance across a point stream, skipping flagged outliers. Used by reports. */
export function routeDistance(points: RawQualityPoint[]): number {
  const ordered = [...points].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  let total = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].accuracy != null && ordered[i].accuracy! > 500) continue;
    total += haversine(ordered[i - 1], ordered[i]);
  }
  return total;
}
