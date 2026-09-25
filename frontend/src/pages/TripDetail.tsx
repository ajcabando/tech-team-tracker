import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AppShell, Badge, Card, EmptyState, ErrorNote, Spinner, StatCard } from '../components/ui';
import { LiveMap } from '../components/LiveMap';
import { ReplayTransport, useTripReplay } from '../components/TripReplay';
import { Link } from '../lib/router';
import { clock, duration, kilometers, shortDateTime, speed } from '../lib/format';

type Stop = { id: string; latitude: number; longitude: number; arrivedAt: string; departedAt: string | null; durationSeconds: number };

export function TripDetailPage({ id }: { id: string }) {
  const replay = useTripReplay(id);
  const { trip, route, current, loading } = replay;
  const [stops, setStops] = useState<Stop[]>([]);
  const [stopsError, setStopsError] = useState('');

  useEffect(() => {
    let active = true;
    api<Stop[]>(`/api/trips/${id}/stops`)
      .then((stopList) => active && setStops(stopList))
      .catch((thrown) => active && setStopsError((thrown as { message?: string })?.message ?? 'Failed to load stops'));
    return () => {
      active = false;
    };
  }, [id]);

  if (loading) return <AppShell title="Trip"><Spinner /></AppShell>;
  if (!trip) return <AppShell title="Trip"><EmptyState title="Trip not found" detail={replay.error || undefined} /></AppShell>;

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
      <ErrorNote message={replay.error || stopsError} />
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
        <ReplayTransport replay={replay} />
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
