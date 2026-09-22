import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { AppShell, Badge, Card, EmptyState, ErrorNote, Spinner, StatCard } from '../components/ui';
import { LiveMap, LatLng } from '../components/LiveMap';
import { Link } from '../lib/router';
import { clock, duration, kilometers, shortDateTime, speed } from '../lib/format';

type Frame = { latitude: number; longitude: number; recordedAt: string; speed: number | null; heading: number | null; accuracy: number | null; offsetSeconds: number; distanceMeters: number };
type Trip = {
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
type Stop = { id: string; latitude: number; longitude: number; arrivedAt: string; departedAt: string | null; durationSeconds: number };

const SPEEDS = [1, 2, 5, 10];

export function TripDetailPage({ id }: { id: string }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(2);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([api<{ trip: Trip; frames: Frame[] }>(`/api/trips/${id}/replay`), api<Stop[]>(`/api/trips/${id}/stops`)])
      .then(([replay, stopList]) => {
        if (!active) return;
        setTrip(replay.trip);
        setFrames(replay.frames);
        setStops(stopList);
        setElapsed(0);
      })
      .catch((thrown) => active && setError((thrown as { message?: string })?.message ?? 'Failed to load trip'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [id]);

  const totalSeconds = frames.length ? frames[frames.length - 1].offsetSeconds : 0;

  useEffect(() => {
    if (!playing) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = window.setInterval(() => {
      setElapsed((current) => {
        const next = current + 100 * (rate / 1000);
        if (next >= totalSeconds) {
          setPlaying(false);
          return totalSeconds;
        }
        return next;
      });
    }, 100);
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

  const route: LatLng[] = frames.map((frame) => [frame.latitude, frame.longitude]);
  const current = frames[currentIndex];

  if (loading) return <AppShell title="Trip"><Spinner /></AppShell>;
  if (!trip) return <AppShell title="Trip"><EmptyState title="Trip not found" /></AppShell>;

  return (
    <AppShell
      title={`Trip · ${kilometers(trip.distanceMeters)}`}
      subtitle={trip.technician ? `${trip.technician.name.toUpperCase()} · ${trip.technician.employeeNumber}` : 'TRIP DETAILS'}
      actions={
        <Link to="/trips" className="link">
          ← All trips
        </Link>
      }
    >
      <ErrorNote message={error} />
      <div className="stats">
        <StatCard label="Start" value={clock(trip.startedAt)} hint={shortDateTime(trip.startedAt)} />
        <StatCard label="End" value={trip.endedAt ? clock(trip.endedAt) : 'In progress'} />
        <StatCard label="Distance" value={kilometers(trip.distanceMeters)} />
        <StatCard label="Driving time" value={duration(trip.drivingSeconds)} />
        <StatCard label="Max speed" value={speed(trip.maxSpeed)} />
        <StatCard label="Average speed" value={speed(trip.averageSpeed)} />
        <StatCard label="Stops" value={trip.stopCount} hint={`Longest ${duration(trip.longestStopSeconds)}`} />
        <StatCard label="GPS points" value={trip.pointCount} />
      </div>

      <Card
        title="Route"
        action={<Badge tone={trip.source === 'AUTO' ? 'primary' : 'muted'}>{trip.source === 'AUTO' ? 'Auto-detected' : 'Manual'}</Badge>}
        className="map-card"
      >
        {route.length > 1 ? (
          <LiveMap
            route={route}
            fitRoute
            height={480}
            playback={
              current
                ? {
                    position: [current.latitude, current.longitude],
                    heading: current.heading,
                    label: `${clock(current.recordedAt)} · ${speed(current.speed ?? 0)}`,
                    iconType: trip.iconType ?? 'pin',
                    iconColor: trip.iconColor ?? undefined,
                  }
                : null
            }
          />
        ) : (
          <EmptyState title="No route points" detail="Raw GPS points may have been removed by your retention policy." />
        )}
      </Card>

      <Card title="Route replay">
        <div className="transport">
          <button
            className="transport-btn"
            onClick={() => {
              setElapsed(0);
              setPlaying(true);
            }}
            disabled={route.length < 2}
            aria-label="Restart replay"
            title="Restart replay"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></svg>
          </button>
          <button
            className="transport-play"
            onClick={() => setPlaying(!playing)}
            disabled={route.length < 2}
            aria-label={playing ? 'Pause replay' : 'Play replay'}
            title={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.4" height="14" rx="1" /><rect x="13.6" y="5" width="3.4" height="14" rx="1" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <div className="transport-rates" role="group" aria-label="Playback speed">
            {SPEEDS.map((value) => (
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
          onChange={(event) => {
            setPlaying(false);
            setElapsed(Number(event.target.value));
          }}
          className="timeline"
        />
        <div className="replay-axis">
          <span>{clock(trip.startedAt)}</span>
          <span>{Math.round(elapsed)}s / {totalSeconds}s</span>
          <span>{trip.endedAt ? clock(trip.endedAt) : 'now'}</span>
        </div>
      </Card>

      <Card title={`Stops (${stops.length})`}>
        {stops.length === 0 && <EmptyState title="No meaningful stops detected" detail="Stops shorter than the configured stop threshold are not recorded." />}
        {stops.map((stop) => (
          <div className="trip-row" key={stop.id}>
            <div>
              <strong>{duration(stop.durationSeconds)}</strong>
              <small>
                Arrived {clock(stop.arrivedAt)} · {stop.departedAt ? `departed ${clock(stop.departedAt)}` : 'still stopped'} · {stop.latitude.toFixed(5)}, {stop.longitude.toFixed(5)}
              </small>
            </div>
          </div>
        ))}
      </Card>
    </AppShell>
  );
}
