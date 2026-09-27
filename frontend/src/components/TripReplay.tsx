import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { LatLng } from './LiveMap';
import { clock, elapsedClock, kilometers, speed } from '../lib/format';

export type ReplayFrame = {
  latitude: number;
  longitude: number;
  recordedAt: string;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  offsetSeconds: number;
  distanceMeters: number;
};

export type ReplayTrip = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  distanceMeters: number;
  drivingSeconds: number;
  maxSpeed: number;
  averageSpeed: number;
  stopCount: number;
  longestStopSeconds: number;
  pointCount: number;
  source: string;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number | null;
  endLongitude: number | null;
  iconType?: string | null;
  iconColor?: string | null;
  technician: { id: string; name: string; employeeNumber: string } | null;
};

export type TripReplayState = {
  trip: ReplayTrip | null;
  frames: ReplayFrame[];
  loading: boolean;
  error: string;
  playing: boolean;
  /** Playback speed multiplier. */
  rate: number;
  /** Position along the trip, in seconds. */
  elapsed: number;
  totalSeconds: number;
  current: ReplayFrame | undefined;
  route: LatLng[];
  canPlay: boolean;
  restart: () => void;
  toggle: () => void;
  setRate: (rate: number) => void;
  seek: (seconds: number) => void;
};

/**
 * Playback multipliers offered in the transport.
 *
 * The previous 1/2/5/10 set was sized for watching a vehicle crawl. At real
 * GPS point density a 1x replay of a multi-hour trip is unwatchable, and at the
 * bottom end the marker advances well under one recorded point per tick.
 */
export const REPLAY_SPEEDS = [20, 50, 70];

/** 50x: a 1h43m trip replays in about two minutes. */
export const DEFAULT_REPLAY_RATE = 50;

const TICK_MS = 100;

/**
 * Index of the last frame at or before `seconds`.
 *
 * Binary search because this runs on every animation tick and the replay
 * endpoint returns up to 10,000 undownsampled points, so the previous linear
 * scan cost ~100k comparisons per second by the end of a long trip. At 10
 * lookups per second this is about 14. `offsetSeconds` is ascending because
 * the endpoint orders points by `recordedAt asc` and derives the offset from it.
 */
function frameIndexAt(frames: ReplayFrame[], seconds: number): number {
  if (!frames.length) return 0;
  let low = 0;
  let high = frames.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (frames[mid].offsetSeconds <= seconds) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

/**
 * Trip replay engine (shared by the trip page and the technician map card):
 * fetches `/api/trips/:id/replay` and advances a clock the UI renders as a
 * moving marker. Pass `tripId = null` to idle with no trip loaded; set
 * `autoPlay` to start moving as soon as the frames arrive.
 */
export function useTripReplay(tripId: string | null, autoPlay = false): TripReplayState {
  const [trip, setTrip] = useState<ReplayTrip | null>(null);
  const [frames, setFrames] = useState<ReplayFrame[]>([]);
  const [loading, setLoading] = useState(Boolean(tripId));
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [rate, setRateState] = useState(DEFAULT_REPLAY_RATE);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!tripId) {
      setTrip(null);
      setFrames([]);
      setPlaying(false);
      setElapsed(0);
      setError('');
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError('');
    setPlaying(false);
    api<{ trip: ReplayTrip; frames: ReplayFrame[] }>(`/api/trips/${tripId}/replay`)
      .then((replay) => {
        if (!active) return;
        setTrip(replay.trip);
        setFrames(replay.frames);
        setElapsed(0);
        if (autoPlay && replay.frames.length > 1) setPlaying(true);
      })
      .catch((thrown) => active && setError((thrown as { message?: string })?.message ?? 'Failed to load trip'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [tripId, autoPlay]);

  const totalSeconds = frames.length ? frames[frames.length - 1].offsetSeconds : 0;

  useEffect(() => {
    if (!playing) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = window.setInterval(() => {
      setElapsed((current) => {
        const next = current + (TICK_MS / 1000) * rate;
        if (next >= totalSeconds) {
          setPlaying(false);
          return totalSeconds;
        }
        return next;
      });
    }, TICK_MS);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [playing, rate, totalSeconds]);

  const currentIndex = useMemo(() => frameIndexAt(frames, elapsed), [frames, elapsed]);

  const route = useMemo(() => frames.map((frame) => [frame.latitude, frame.longitude] as LatLng), [frames]);
  const canPlay = route.length > 1;

  return {
    trip,
    frames,
    loading,
    error,
    playing,
    rate,
    elapsed,
    totalSeconds,
    current: frames[currentIndex],
    route,
    canPlay,
    restart: () => {
      setElapsed(0);
      if (canPlay) setPlaying(true);
    },
    toggle: () => {
      if (playing) {
        setPlaying(false);
        return;
      }
      if (!canPlay) return;
      // Pressing play after the end starts over instead of instantly re-pausing.
      if (elapsed >= totalSeconds) setElapsed(0);
      setPlaying(true);
    },
    setRate: setRateState,
    seek: (seconds: number) => {
      setPlaying(false);
      setElapsed(Math.max(0, Math.min(seconds, totalSeconds)));
    },
  };
}

/** Transport controls, readout, scrubber and time axis for a replay. */
export function ReplayTransport({ replay }: { replay: TripReplayState }) {
  const { playing, rate, elapsed, totalSeconds, current, canPlay, trip, restart, toggle, setRate, seek } = replay;

  return (
    <div className="replay">
      <div className="transport">
        <button className="transport-btn" onClick={restart} disabled={!canPlay} aria-label="Restart replay" title="Restart replay">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></svg>
        </button>
        <button className="transport-play" onClick={toggle} disabled={!canPlay} aria-label={playing ? 'Pause replay' : 'Play replay'} title={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.4" height="14" rx="1" /><rect x="13.6" y="5" width="3.4" height="14" rx="1" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
        <div className="transport-rates" role="group" aria-label="Playback speed">
          {REPLAY_SPEEDS.map((value) => (
            <button key={value} className={rate === value ? 'chip active' : 'chip'} onClick={() => setRate(value)} aria-pressed={rate === value}>
              {value}×
            </button>
          ))}
        </div>
      </div>
      <div className="replay-readout">
        <div>
          <small>Time</small>
          <strong>{current ? clock(current.recordedAt) : '—'}</strong>
        </div>
        <div>
          <small>Speed</small>
          <strong>{speed(current?.speed ?? 0)}</strong>
        </div>
        <div>
          <small>Distance</small>
          <strong>{current ? kilometers(current.distanceMeters) : '—'}</strong>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(totalSeconds, 1)}
        value={Math.round(elapsed)}
        onChange={(event) => seek(Number(event.target.value))}
        className="timeline"
        aria-label="Replay position"
      />
      <div className="replay-axis">
        <span>{trip ? clock(trip.startedAt) : '—'}</span>
        <span>
          {elapsedClock(elapsed)} / {elapsedClock(totalSeconds)}
        </span>
        <span>{trip?.endedAt ? clock(trip.endedAt) : 'now'}</span>
      </div>
    </div>
  );
}
