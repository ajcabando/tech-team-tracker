import { describe, expect, it } from 'vitest';
import { detectTrips } from './trips';

const start = new Date('2026-09-21T08:00:00.000Z');
const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);

/** Generate a straight-line drive where each step advances ~0.001 degrees longitude. */
function drive(steps: number, from: { lat: number; lon: number }, startSeconds = 0) {
  return Array.from({ length: steps }, (_, index) => ({
    latitude: from.lat + index * 0.001,
    longitude: from.lon + index * 0.001,
    recordedAt: at(startSeconds + index * 10),
    accuracy: 5,
  }));
}

describe('detectTrips', () => {
  it('detects a single trip from continuous movement', () => {
    const trips = detectTrips(drive(10, { lat: 10.3, lon: 123.9 }));
    expect(trips).toHaveLength(1);
    expect(trips[0].distanceMeters).toBeGreaterThan(500);
    expect(trips[0].maxSpeed).toBeGreaterThan(0);
  });

  it('returns no trip when the vehicle never moves', () => {
    const points = Array.from({ length: 12 }, (_, index) => ({
      latitude: 10.3,
      longitude: 123.9,
      recordedAt: at(index * 30),
      accuracy: 5,
    }));
    expect(detectTrips(points)).toHaveLength(0);
  });

  it('ends the trip after a long stationary period and records a stop', () => {
    const moving = drive(8, { lat: 10.3, lon: 123.9 });
    const parked = Array.from({ length: 7 }, (_, index) => ({
      latitude: 10.307,
      longitude: 123.907,
      recordedAt: at(80 + index * 60),
      accuracy: 5,
    }));
    const trips = detectTrips([...moving, ...parked]);
    expect(trips).toHaveLength(1);
    expect(trips[0].stopCount).toBe(1);
    expect(trips[0].longestStopSeconds).toBeGreaterThanOrEqual(300);
  });

  it('records a short stop inside the trip when movement resumes', () => {
    const firstLeg = drive(6, { lat: 10.3, lon: 123.9 });
    const pause = [1, 2, 3].map((index) => ({ latitude: 10.305, longitude: 123.905, recordedAt: at(50 + index * 40), accuracy: 5 }));
    const secondLeg = drive(6, { lat: 10.31, lon: 123.91 }, 200);
    const trips = detectTrips([...firstLeg, ...pause, ...secondLeg]);
    expect(trips).toHaveLength(1);
    expect(trips[0].stopCount).toBeGreaterThanOrEqual(1);
    expect(trips[0].stops[0].departedAt).not.toBeNull();
  });

  it('ignores impossible jumps instead of creating fake distance', () => {
    const points = [
      ...drive(5, { lat: 10.3, lon: 123.9 }),
      { latitude: 40, longitude: 100, recordedAt: at(60), accuracy: 900 },
      ...drive(5, { lat: 10.31, lon: 123.91 }, 70),
    ];
    const trips = detectTrips(points);
    // Without outlier filtering this jump alone would add thousands of kilometres.
    expect(trips[0].distanceMeters).toBeLessThan(5000);
  });
});
