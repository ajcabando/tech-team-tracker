import { describe, expect, it } from 'vitest';
import { classifyQuality, flagOutliers, haversine, metersPerSecondToKmh } from './geo';

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
});

describe('metersPerSecondToKmh', () => {
  it('converts m/s to km/h', () => {
    expect(metersPerSecondToKmh(10)).toBeCloseTo(36);
  });
});
