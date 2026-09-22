import { describe, expect, it } from 'vitest';
import { classifyQuality, effectiveSpeed, flagOutliers, haversine, metersPerSecondToKmh, MAX_PLAUSIBLE_SPEED_KMH } from './geo';

describe('haversine', () => {
  it('computes great-circle distance', () => {
    const meters = haversine({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 });
    expect(meters).toBeGreaterThan(111000);
    expect(meters).toBeLessThan(111500);
  });

  it('returns zero for identical points', () => {
    expect(haversine({ latitude: 10.3, longitude: 123.9 }, { latitude: 10.3, longitude: 123.9 })).toBe(0);
  });
});

describe('classifyQuality', () => {
  it('marks tight fixes good', () => {
    expect(classifyQuality({ accuracy: 4 })).toBe('GOOD');
  });
  it('marks borderline fixes fair', () => {
    expect(classifyQuality({ accuracy: 60 })).toBe('FAIR');
  });
  it('marks wide fixes poor', () => {
    expect(classifyQuality({ accuracy: 250 })).toBe('POOR');
  });
});

describe('flagOutliers', () => {
  it('flags an impossible jump in one second', () => {
    const flagged = flagOutliers([
      { latitude: 10, longitude: 123, recordedAt: new Date(1000) },
      { latitude: 20, longitude: 130, recordedAt: new Date(2000) },
    ]);
    expect(flagged[1].outlier).toBe(true);
    expect(flagged[1].quality).toBe('POOR');
  });

  it('keeps realistic movement', () => {
    const flagged = flagOutliers([
      { latitude: 10.0, longitude: 123.0, recordedAt: new Date(0) },
      { latitude: 10.001, longitude: 123.001, recordedAt: new Date(10000) },
    ]);
    expect(flagged[1].outlier).toBe(false);
  });

  it('flags duplicate timestamps', () => {
    const flagged = flagOutliers([
      { latitude: 10.0, longitude: 123.0, recordedAt: new Date(5000) },
      { latitude: 10.0, longitude: 123.0, recordedAt: new Date(5000) },
    ]);
    expect(flagged[1].outlier).toBe(true);
  });

  it('flags device-reported speed above ~350 km/h', () => {
    const flagged = flagOutliers([
      { latitude: 10.0, longitude: 123.0, recordedAt: new Date(0), speed: 400 },
    ]);
    expect(flagged[0].outlier).toBe(true);
    expect(flagged[0].quality).toBe('POOR');
  });

  it('does not flag a realistic reported speed', () => {
    const flagged = flagOutliers([
      { latitude: 10.0, longitude: 123.0, recordedAt: new Date(0), speed: 90 },
    ]);
    expect(flagged[0].outlier).toBe(false);
  });
});

describe('effectiveSpeed', () => {
  const prev = { latitude: 10.3, longitude: 123.9, recordedAt: new Date(0) };
  // ~20 km/h over 10s (~55 m) — quiet city geometry
  const curr = { latitude: 10.3005, longitude: 123.9, recordedAt: new Date(10_000) };

  it('caps reported speed at the fleet ceiling', () => {
    expect(effectiveSpeed({ speed: 183 }, prev, curr)).toBeLessThanOrEqual(MAX_PLAUSIBLE_SPEED_KMH);
    expect(effectiveSpeed({ speed: 300 }, prev, curr)).toBeLessThanOrEqual(MAX_PLAUSIBLE_SPEED_KMH);
  });

  it('prefers geometry when reported speed is more than 2× derived', () => {
    // Geometry implies ~20 km/h; reported 90 is a multipath spike under the ceiling.
    const derived = effectiveSpeed({ speed: null }, prev, curr);
    const result = effectiveSpeed({ speed: 90 }, prev, curr);
    expect(derived).toBeGreaterThan(0);
    expect(derived).toBeLessThan(45);
    expect(90).toBeGreaterThan(2 * derived);
    expect(result).toBeCloseTo(derived, 5);
    expect(result).toBeLessThan(90);
  });

  it('keeps a plausible reported speed close to geometry', () => {
    const derived = effectiveSpeed({ speed: null }, prev, curr);
    const result = effectiveSpeed({ speed: derived + 5 }, prev, curr);
    expect(result).toBeCloseTo(derived + 5, 5);
  });

  it('falls back to derived when reported speed is missing', () => {
    expect(effectiveSpeed({ speed: null }, prev, curr)).toBeGreaterThan(0);
  });

  it('returns 0 with no speed and no geometry', () => {
    expect(effectiveSpeed({ speed: null })).toBe(0);
  });
});

describe('metersPerSecondToKmh', () => {
  it('converts m/s to km/h', () => {
    expect(metersPerSecondToKmh(10)).toBeCloseTo(36);
  });
});
