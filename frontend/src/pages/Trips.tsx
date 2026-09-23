import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { AppShell, Badge, Card, EmptyState, ErrorNote, Field, Spinner } from '../components/ui';
import { TripMapThumb } from '../components/TripMapThumb';
import { useRouter } from '../lib/router';
import { clock, dateInputValue, duration, kilometers, shortDateTime, speed } from '../lib/format';

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
  source: 'AUTO' | 'MANUAL';
  startLatitude: number;
  startLongitude: number;
  endLatitude: number | null;
  endLongitude: number | null;
  technician: { id: string; name: string; employeeNumber: string } | null;
};

type Technician = { id: string; name: string; employeeNumber: string };

function startOf(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}
function endOf(value: string): string {
  return new Date(`${value}T23:59:59`).toISOString();
}

export function TripsPage() {
  const { navigate, query } = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [technicianId, setTechnicianId] = useState(query.get('technicianId') ?? '');
  const [from, setFrom] = useState(dateInputValue());
  const [to, setTo] = useState(dateInputValue());

  useEffect(() => {
    void api<Technician[]>('/api/technicians').then(setTechnicians).catch(() => setTechnicians([]));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (technicianId) params.set('technicianId', technicianId);
    if (from) params.set('from', startOf(from));
    if (to) params.set('to', endOf(to));
    params.set('limit', '200');
    api<Trip[]>(`/api/trips?${params.toString()}`)
      .then((result) => active && setTrips(result))
      .catch((thrown) => active && setError((thrown as { message?: string })?.message ?? 'Failed to load trips'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [technicianId, from, to]);

  const grouped = useMemo(() => {
    const map = new Map<string, Trip[]>();
    for (const trip of trips) {
      const key = new Date(trip.startedAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
      map.set(key, [...(map.get(key) ?? []), trip]);
    }
    return Array.from(map.entries());
  }, [trips]);

  const totals = trips.reduce(
    (accumulator, trip) => ({
      distance: accumulator.distance + trip.distanceMeters,
      seconds: accumulator.seconds + trip.drivingSeconds,
      stops: accumulator.stops + trip.stopCount,
    }),
    { distance: 0, seconds: 0, stops: 0 },
  );

  return (
    <AppShell title="Trip history" subtitle="TRIPS">
      <Card title="Filters">
        <div className="grid four">
          <Field label="Technician">
            <select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>
              <option value="">All technicians</option>
              {technicians.map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.name} ({technician.employeeNumber})
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </Field>
          <Field label="To">
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </Field>
          <Field label="Presets">
            <div className="row-actions">
              <button
                className="outline"
                onClick={() => {
                  setFrom(dateInputValue());
                  setTo(dateInputValue());
                }}
              >
                Today
              </button>
              <button
                className="outline"
                onClick={() => {
                  const week = new Date(Date.now() - 6 * 86400000);
                  setFrom(dateInputValue(week));
                  setTo(dateInputValue());
                }}
              >
                7 days
              </button>
              <button
                className="outline"
                onClick={() => {
                  const month = new Date(Date.now() - 29 * 86400000);
                  setFrom(dateInputValue(month));
                  setTo(dateInputValue());
                }}
              >
                30 days
              </button>
            </div>
          </Field>
        </div>
        <div className="trip-summary">
          <span>
            <strong>{trips.length}</strong> trips
          </span>
          <span>
            <strong>{kilometers(totals.distance)}</strong> total distance
          </span>
          <span>
            <strong>{duration(totals.seconds)}</strong> driving time
          </span>
          <span>
            <strong>{totals.stops}</strong> stops
          </span>
        </div>
      </Card>

      <ErrorNote message={error} />
      {loading && <Spinner />}
      {!loading && trips.length === 0 && <EmptyState title="No trips in this range" detail="Trips are detected automatically from uploaded GPS points once movement ends." />}

      {grouped.map(([day, dayTrips]) => (
        <Card key={day} title={day}>
          {dayTrips.map((trip) => (
            <div className="trip-row" key={trip.id} onClick={() => navigate(`/trips/${trip.id}`)}>
              <TripMapThumb
                tripId={trip.id}
                start={[trip.startLatitude, trip.startLongitude]}
                end={trip.endLatitude != null && trip.endLongitude != null ? [trip.endLatitude, trip.endLongitude] : null}
              />
              <div>
                <strong>{kilometers(trip.distanceMeters)}</strong>
                <small>
                  {clock(trip.startedAt)} – {trip.endedAt ? clock(trip.endedAt) : 'in progress'} · {trip.technician?.name ?? 'Unknown'}
                </small>
              </div>
              <div className="trip-meta">
                <Badge tone={trip.source === 'AUTO' ? 'primary' : 'muted'}>{trip.source === 'AUTO' ? 'Auto' : 'Manual'}</Badge>
                <span>{duration(trip.drivingSeconds)}</span>
                <span>{speed(trip.maxSpeed)}</span>
                <span>{trip.stopCount} stops</span>
              </div>
            </div>
          ))}
        </Card>
      ))}
    </AppShell>
  );
}
