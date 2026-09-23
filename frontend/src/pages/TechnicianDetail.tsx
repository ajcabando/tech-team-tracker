import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AppShell, Badge, Card, EmptyState, ErrorNote, RemoveDialog, Spinner, StatCard, Avatar } from '../components/ui';
import { LiveMap, LatLng } from '../components/LiveMap';
import { TripMapThumb } from '../components/TripMapThumb';
import { Link, useRouter } from '../lib/router';
import { clock, duration, kilometers, relativeTime, shortDateTime, speed } from '../lib/format';
import { useAuth } from '../state/auth';

type Detail = {
  id: string;
  name: string;
  employeeNumber: string;
  email: string | null;
  phone: string | null;
  status: string;
  devices: Array<{ id: string; deviceName: string; status: string; batteryLevel: number | null; lastLatitude: number | null; lastLongitude: number | null; lastSpeed: number | null; lastAccuracy: number | null; lastSeen: string | null; appVersion: string | null; androidVersion: string | null; unpairedAt: string | null }>;
  today: { distanceMeters: number; tripCount: number; drivingSeconds: number; maxSpeed: number; locationPoints: number; firstActivity: string | null; lastActivity: string | null };
};

type Trip = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  distanceMeters: number;
  drivingSeconds: number;
  maxSpeed: number;
  stopCount: number;
  startLatitude: number;
  startLongitude: number;
  endLatitude: number | null;
  endLongitude: number | null;
};

export function TechnicianDetailPage({ id }: { id: string }) {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const canRemove = user?.role === 'SUPERADMIN' || user?.role === 'ADMIN';
  const [removing, setRemoving] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [route, setRoute] = useState<Array<{ latitude: number; longitude: number }>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  const load = async () => {
    try {
      const [technician, tripList, points] = await Promise.all([
        api<Detail>(`/api/technicians/${id}`),
        api<Trip[]>(`/api/technicians/${id}/trips?limit=20`),
        api<Array<{ latitude: number; longitude: number }>>(`/api/technicians/${id}/locations`),
      ]);
      setDetail(technician);
      setTrips(tripList);
      setRoute(points);
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Failed to load technician');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function unpair(deviceId: string) {
    try {
      await api(`/api/devices/${deviceId}/unpair`, { method: 'POST' });
      await load();
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Failed to unpair device');
    }
  }

  async function toggleStatus() {
    if (!detail) return;
    try {
      await api(`/api/technicians/${detail.id}`, { method: 'PATCH', body: { status: detail.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' } });
      await load();
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Failed to update the technician');
    }
  }

  if (busy) return <AppShell title="Technician"><Spinner /></AppShell>;
  if (!detail) return <AppShell title="Technician"><EmptyState title="Technician not found" /></AppShell>;

  const device = detail.devices.find((entry) => entry.status === 'ACTIVE') ?? detail.devices[0];
  const routePoints: LatLng[] = route.map((point) => [point.latitude, point.longitude]);

  return (
    <AppShell
      title={detail.name}
      subtitle={`${detail.employeeNumber} · TECHNICIAN`}
      actions={
        <div className="row-actions">
          <Link to="/technicians" className="link">
            ← All technicians
          </Link>
          <Link to={`/trips?technicianId=${detail.id}`} className="outline as-button">
            Trip history
          </Link>
        </div>
      }
    >
      <ErrorNote message={error} />
      <div className="profile-head">
        <Avatar name={detail.name} />
        <div>
          <strong>{detail.name}</strong>
          <small>
            {detail.phone ?? 'No phone'} · {detail.email ?? 'No email'}
          </small>
        </div>
        <Badge tone={detail.status === 'ACTIVE' ? 'good' : 'bad'}>{detail.status}</Badge>
      </div>

      <div className="stats">
        <StatCard label="Distance today" value={kilometers(detail.today.distanceMeters)} />
        <StatCard label="Trips today" value={detail.today.tripCount} />
        <StatCard label="Driving time" value={duration(detail.today.drivingSeconds)} />
        <StatCard label="Max speed today" value={speed(detail.today.maxSpeed)} />
        <StatCard label="GPS points today" value={detail.today.locationPoints} />
        <StatCard label="Last activity" value={relativeTime(detail.today.lastActivity)} />
      </div>

      <div className="workspace">
        <Card title="Today's actual GPS route" className="map-card">
          {routePoints.length > 1 ? <LiveMap route={routePoints} fitRoute height={460} /> : <EmptyState title="No GPS points in the last 24 hours" />}
        </Card>

        <div className="stack">
          <Card title="Devices">
            {detail.devices.length === 0 && <EmptyState title="No devices" detail="Generate a pairing code from the Technicians page." />}
            {detail.devices.map((entry) => (
              <div className="device-row" key={entry.id}>
                <div className="tech-info">
                  <strong>{entry.deviceName}</strong>
                  <small>
                    {entry.status} · Android {entry.androidVersion ?? '—'} · App {entry.appVersion ?? '—'}
                  </small>
                  <small>
                    Battery {entry.batteryLevel ?? '—'}% · GPS ±{entry.lastAccuracy != null ? Math.round(entry.lastAccuracy) : '—'} m · {relativeTime(entry.lastSeen)}
                  </small>
                </div>
                {entry.status === 'ACTIVE' && (
                  <button className="outline danger" onClick={() => void unpair(entry.id)}>
                    Unpair
                  </button>
                )}
              </div>
            ))}
          </Card>

          {canRemove && (
            <Card title="Manage technician">
              <p className="muted">Deactivating keeps the technician and all history but marks them inactive. Removing detaches their devices.</p>
              <div className="row-actions">
                <button className="outline" onClick={() => void toggleStatus()}>
                  {detail.status === 'ACTIVE' ? 'Deactivate technician' : 'Reactivate technician'}
                </button>
                <button className="outline danger" onClick={() => setRemoving(true)}>
                  Remove technician
                </button>
              </div>
            </Card>
          )}

          <Card title="Recent trips" action={<Link to={`/trips?technicianId=${detail.id}`} className="link">View all →</Link>}>
            {trips.length === 0 && <EmptyState title="No trips recorded yet" />}
            {trips.slice(0, 6).map((trip) => (
              <div className="trip-row" key={trip.id} onClick={() => navigate(`/trips/${trip.id}`)}>
                <TripMapThumb
                  tripId={trip.id}
                  start={[trip.startLatitude, trip.startLongitude]}
                  end={trip.endLatitude != null && trip.endLongitude != null ? [trip.endLatitude, trip.endLongitude] : null}
                />
                <div>
                  <strong>{kilometers(trip.distanceMeters)}</strong>
                  <small>
                    {shortDateTime(trip.startedAt)} – {trip.endedAt ? clock(trip.endedAt) : 'in progress'}
                  </small>
                </div>
                <div className="trip-meta">
                  <span>{duration(trip.drivingSeconds)}</span>
                  <span>{trip.stopCount} stops</span>
                  <span>{speed(trip.maxSpeed)}</span>
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>

      {removing && detail && (
        <RemoveDialog
          title="Remove technician"
          subject={`${detail.name} · ${detail.employeeNumber}`}
          consequence="The technician disappears from the roster and their linked devices are detached, so the phone can no longer upload. Deactivating instead keeps them listed with their history."
          remove={async (purge) => {
            await api(`/api/technicians/${detail.id}${purge ? '?purge=true' : ''}`, { method: 'DELETE' });
          }}
          onClose={() => setRemoving(false)}
          onRemoved={() => navigate('/technicians')}
        />
      )}
    </AppShell>
  );
}
