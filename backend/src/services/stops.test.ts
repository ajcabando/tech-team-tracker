import { describe, expect, it } from 'vitest';
import { detectStops } from './stops';

const start = new Date('2026-09-21T08:00:00.000Z');
const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);

/** Points every `stepSeconds` at a fixed spot — i.e. the device is parked. */
function park(count: number, from: { lat: number; lon: number }, startSeconds = 0, stepSeconds = 60) {
  return Array.from({ length: count }, (_, index) => ({
    latitude: from.lat,
    longitude: from.lon,
    recordedAt: at(startSeconds + index * stepSeconds),
    accuracy: 5,
  }));
}

/** A short hop that is clearly movement (~2.2 m/s) between two nearby spots. */
function hop(from: { lat: number; lon: number }, steps: number, startSeconds: number) {
  return Array.from({ length: steps }, (_, index) => ({
    latitude: from.lat + (index + 1) * 0.0001,
    longitude: from.lon,
    recordedAt: at(startSeconds + index * 5),
    accuracy: 5,
  }));
}

describe('detectStops', () => {
  it('records a long park as an open stop at the end of the stream', () => {
    const stops = detectStops(park(11, { lat: 10.3, lon: 123.9 }));
    expect(stops).toHaveLength(1);
    expect(stops[0].arrivedAt).toEqual(at(0));
    expect(stops[0].departedAt).toBeNull();
    expect(stops[0].durationSeconds).toBe(600);
    expect(stops[0].pointCount).toBe(11);
  });

  it('ignores stationary periods shorter than the minimum', () => {
    // 4 minutes of stillness — below the 300s default.
    expect(detectStops(park(5, { lat: 10.3, lon: 123.9 }, 0, 60))).toHaveLength(0);
  });

  it('closes the stop when movement resumes', () => {
    const points = [
      ...park(7, { lat: 10.3, lon: 123.9 }, 0, 60), // parked 0–360 s
      ...hop({ lat: 10.3, lon: 123.9 }, 4, 365), // leaves at 365 s
      ...park(6, { lat: 10.3004, lon: 123.9 }, 385, 60), // parked again
      ...hop({ lat: 10.3004, lon: 123.9 }, 3, 690), // drives off for good
    ];
    const stops = detectStops(points);
    expect(stops).toHaveLength(1);
    expect(stops[0].departedAt).not.toBeNull();
    expect(stops[0].durationSeconds).toBe(660);
  });

  it('merges two nearby visits into one record with the total time there', () => {
    const points = [
      ...park(10, { lat: 10.3, lon: 123.9 }, 0, 60), // 9 min parked
      ...hop({ lat: 10.3, lon: 123.9 }, 3, 540), // ~10 s hop, ~33 m away
      ...park(10, { lat: 10.3003, lon: 123.9 }, 555, 60), // 9 min parked again
    ];
    const stops = detectStops(points);
    expect(stops).toHaveLength(1);
    expect(stops[0].arrivedAt).toEqual(at(0));
    expect(stops[0].durationSeconds).toBe(540 + 540);
    expect(stops[0].pointCount).toBe(20);
  });

  it('keeps stops at different places separate', () => {
    const points = [
      ...park(10, { lat: 10.3, lon: 123.9 }, 0, 60),
      // ~111 m steps for 10 s — an unmistakable drive to another area.
      ...Array.from({ length: 6 }, (_, index) => ({
        latitude: 10.3 + (index + 1) * 0.001,
        longitude: 123.9,
        recordedAt: at(540 + index * 10),
        accuracy: 5,
      })),
      ...park(10, { lat: 10.306, lon: 123.9 }, 610, 60),
    ];
    const stops = detectStops(points);
    expect(stops).toHaveLength(2);
    expect(stops[0].latitude).toBeCloseTo(10.3, 4);
    expect(stops[1].latitude).toBeCloseTo(10.306, 4);
    expect(stops[1].departedAt).toBeNull();
  });

  it('does not split a park when a bad fix lands in the middle', () => {
    const points = [
      ...park(6, { lat: 10.3, lon: 123.9 }, 0, 60),
      { latitude: 40, longitude: 100, recordedAt: at(300), accuracy: 900 },
      ...park(6, { lat: 10.3, lon: 123.9 }, 360, 60),
    ];
    const stops = detectStops(points);
    expect(stops).toHaveLength(1);
    expect(stops[0].durationSeconds).toBe(660);
    // The fix right after the teleport is rejected too — same as trip detection.
    expect(stops[0].pointCount).toBe(11);
  });

  it('respects a custom minimum duration', () => {
    const stops = detectStops(park(5, { lat: 10.3, lon: 123.9 }, 0, 60), { minStopSeconds: 120 });
    expect(stops).toHaveLength(1);
    expect(stops[0].durationSeconds).toBe(240);
  });

  it('returns nothing for an empty or single-point stream', () => {
    expect(detectStops([])).toHaveLength(0);
    expect(detectStops(park(1, { lat: 10.3, lon: 123.9 }))).toHaveLength(0);
  });
});
