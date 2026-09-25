import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { LatLng } from './LiveMap';
import { clock, kilometers, speed } from '../lib/format';

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

export const REPLAY_SPEEDS = [1, 2, 5, 10];
const TICK_MS = 100;

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
  const [rate, setRateState] = useState(2);
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

  const currentIndex = useMemo(() => {
    if (!frames.length) return 0;
    let index = 0;
    for (let i = 0; i < frames.length; i += 1) {
      if (frames[i].offsetSeconds <= elapsed) index = i;
      else break;
    }
    return index;
  }, [frames, elapsed]);

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
          {Math.round(elapsed)}s / {totalSeconds}s
        </span>
        <span>{trip?.endedAt ? clock(trip.endedAt) : 'now'}</span>
      </div>
    </div>
  );
}
