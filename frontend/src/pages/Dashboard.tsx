import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, openStream } from '../lib/api';
import { LiveMap, MapDevice, TileLayerKey } from '../components/LiveMap';
import { AppShell, Avatar, Badge, Card, EmptyState, KpiCard, SkeletonCard, Spinner } from '../components/ui';
import { Link, useRouter } from '../lib/router';
import { useAuth } from '../state/auth';
import { batteryTone, clock, duration, kilometers, relativeTime, speed } from '../lib/format';

type Summary = {
  totalTechnicians: number;
  totalDevices: number;
  online: number;
  moving: number;
  idle: number;
  offline: number;
  tripsToday: number;
  distanceTodayMeters: number;
  drivingTodaySeconds: number;
  maxSpeedToday: number;
  lowBatteryCount: number;
  poorGpsCount: number;
};

type LiveDevice = MapDevice & { status: string; technician: { id: string; name: string; employeeNumber: string } | null };

type TripFeed = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  distanceMeters: number;
  technician: { id: string; name: string; employeeNumber: string } | null;
};

type AlertFeed = {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  createdAt: string;
  technician: { id: string; name: string } | null;
};

type FeedItem = { key: string; kind: 'trip' | 'alert'; tone: 'good' | 'warn' | 'bad' | 'primary'; title: string; detail: string; time: string; timeMs: number };

type TodayTrip = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  distanceMeters: number;
  drivingSeconds: number;
  technician: { id: string; name: string; employeeNumber: string } | null;
};

const KPI_ICONS: Record<string, React.ReactNode> = {
  tech: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><circle cx="17" cy="9" r="2.6" /><path d="M15.6 14.6c2.3.2 4 1.6 4.5 4" /></svg>
  ),
  online: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1.6" /><path d="M8.5 15.5a5 5 0 0 1 7 0" /><path d="M5.8 18.2a8.5 8.5 0 0 1 12.4 0" /><path d="M11 5.5A8.5 8.5 0 0 1 20.5 12M13 2.5a12 12 0 0 1 7.5 7.5" /></svg>
  ),
  moving: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19L19 5" /><path d="M9 5h10v10" /></svg>
  ),
  idle: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14" /><path d="M15 5v14" /></svg>
  ),
  trips: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13l-3-3" /><path d="M20 16H7l3 3" /></svg>
  ),
  distance: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 20L10 4" /><path d="M18 20L14 4" /><path d="M12 6v2M12 11v2M12 16v2" /></svg>
  ),
  speed: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19a8 8 0 1 1 14 0" /><path d="M12 13l4-5" /></svg>
  ),
  health: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" /></svg>
  ),
};

const MAP_FILTERS = ['all', 'online', 'moving', 'idle', 'offline'] as const;
type MapFilter = (typeof MAP_FILTERS)[number];

const TILE_OPTIONS: Array<{ key: TileLayerKey; label: string }> = [
  { key: 'standard', label: 'Standard' },
  { key: 'humanitarian', label: 'Relief' },
  { key: 'satellite', label: 'Satellite' },
];

function startOfToday(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

function humanizeAlertType(type: string): string {
  return type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const ALERT_TONE = { INFO: 'primary', WARNING: 'warn', CRITICAL: 'bad' } as const;

export function DashboardPage() {
  const { navigate } = useRouter();
  const { user } = useAuth();
  const [devices, setDevices] = useState<LiveDevice[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trips, setTrips] = useState<TripFeed[]>([]);
  const [alerts, setAlerts] = useState<AlertFeed[]>([]);
  const [todayTrips, setTodayTrips] = useState<TodayTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [selected, setSelected] = useState<LiveDevice | null>(null);
  const [mapFilter, setMapFilter] = useState<MapFilter>('all');
  const [tiles, setTiles] = useState<TileLayerKey>('standard');
  const [fitSignal, setFitSignal] = useState(0);
  const mapWrapRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [liveDevices, summaryData, recentTrips, recentAlerts, todaysTrips] = await Promise.all([
          api<LiveDevice[]>('/api/dashboard/live'),
          api<Summary>('/api/dashboard/summary'),
          api<TripFeed[]>('/api/trips?limit=20').catch(() => [] as TripFeed[]),
          api<AlertFeed[]>('/api/alerts?limit=20').catch(() => [] as AlertFeed[]),
          api<TodayTrip[]>(`/api/trips?from=${encodeURIComponent(startOfToday())}&limit=10`).catch(() => [] as TodayTrip[]),
        ]);
        if (!active) return;
        setDevices(liveDevices);
        setSummary(summaryData);
        setTrips(recentTrips);
        setAlerts(recentAlerts);
        setTodayTrips(todaysTrips);
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();

    const source = openStream('/api/dashboard/stream', {
      ready: () => active && setLive(true),
      location: (payload) => {
        const update = payload as { deviceId: string; latitude: number; longitude: number; speed: number; accuracy: number | null; battery: number | null; recordedAt: string };
        setDevices((current) =>
          current.map((device) =>
            device.id === update.deviceId
              ? { ...device, lastLatitude: update.latitude, lastLongitude: update.longitude, lastSpeed: update.speed, lastAccuracy: update.accuracy, batteryLevel: update.battery, lastSeen: update.recordedAt }
              : device,
          ),
        );
      },
      alert: () => void load(),
      trip: () => void load(),
      device: () => void load(),
    });
    source.onerror = () => setLive(false);
    sourceRef.current = source;

    const poll = setInterval(load, 20000);
    return () => {
      active = false;
      clearInterval(poll);
      source.close();
    };
  }, []);

  const now = Date.now();
  const statusOf = (device: LiveDevice) => {
    const isOnline = device.lastSeen ? now - new Date(device.lastSeen).getTime() < 5 * 60 * 1000 : false;
    const isMoving = isOnline && (device.lastSpeed ?? 0) >= 3;
    return { isOnline, isMoving, state: !isOnline ? 'offline' : isMoving ? 'moving' : 'idle' } as const;
  };

  const filtered = useMemo(() => {
    if (mapFilter === 'all') return devices;
    return devices.filter((device) => statusOf(device).state === mapFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, mapFilter]);

  const feed = useMemo<FeedItem[]>(() => {
    const tripItems: FeedItem[] = trips.map((trip) => ({
      key: `trip-${trip.id}`,
      kind: 'trip',
      tone: trip.endedAt ? 'good' : 'primary',
      title: trip.endedAt ? 'Trip completed' : 'Trip started',
      detail: `${trip.technician?.name ?? 'Unknown'} · ${kilometers(trip.distanceMeters)}`,
      time: trip.endedAt ?? trip.startedAt,
      timeMs: new Date(trip.endedAt ?? trip.startedAt).getTime(),
    }));
    const alertItems: FeedItem[] = alerts.map((alert) => ({
      key: `alert-${alert.id}`,
      kind: 'alert',
      tone: ALERT_TONE[alert.severity],
      title: humanizeAlertType(alert.type),
      detail: `${alert.technician?.name ?? 'Unknown'} · ${alert.message}`,
      time: alert.createdAt,
      timeMs: new Date(alert.createdAt).getTime(),
    }));
    return [...tripItems, ...alertItems]
      .filter((item) => Number.isFinite(item.timeMs))
      .sort((a, b) => b.timeMs - a.timeMs)
      .slice(0, 9);
  }, [trips, alerts]);

  const onlineRate = summary && summary.totalTechnicians > 0 ? Math.round((summary.online / summary.totalTechnicians) * 100) : null;
  const healthWarnings = (summary?.lowBatteryCount ?? 0) + (summary?.poorGpsCount ?? 0);
  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const located = filtered.filter((device) => device.lastLatitude != null && device.lastLongitude != null);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void mapWrapRef.current?.requestFullscreen();
  };

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  return (
    <AppShell
      title="Dashboard"
      subtitle={`Welcome back, ${firstName} · Real-time location of your technicians in the field`.toUpperCase()}
      actions={
        <span className={`live-pill ${live ? 'is-live' : ''}`}>
          <span className="status-dot" />
          {live ? 'Live stream connected' : 'Refreshing every 20s'}
        </span>
      }
    >
      <div className="kpis">
        {loading && !summary ? (
          <>
            {Array.from({ length: 8 }, (_, index) => (
              <div className="kpi" key={index}>
                <SkeletonCard lines={2} />
              </div>
            ))}
          </>
        ) : (
          <>
            <KpiCard icon={KPI_ICONS.tech} label="Total technicians" value={summary?.totalTechnicians ?? devices.length} sub={`${summary?.totalDevices ?? devices.length} devices`} />
            <KpiCard icon={KPI_ICONS.online} label="Online" value={summary?.online ?? 0} tone="good" sub={onlineRate != null ? `${onlineRate}% online rate` : 'Active in last 5 minutes'} />
            <KpiCard icon={KPI_ICONS.moving} label="Moving" value={summary?.moving ?? 0} sub="Speed ≥ 3 km/h" />
            <KpiCard icon={KPI_ICONS.idle} label="Idle" value={summary?.idle ?? 0} sub="Stopped < 3 km/h" />
            <KpiCard icon={KPI_ICONS.trips} label="Trips today" value={summary?.tripsToday ?? 0} sub="Detected automatically" />
            <KpiCard icon={KPI_ICONS.distance} label="Distance today" value={kilometers(summary?.distanceTodayMeters ?? 0)} sub="Across the fleet" />
            <KpiCard icon={KPI_ICONS.speed} label="Max speed today" value={speed(summary?.maxSpeedToday ?? 0)} sub="Fastest recorded" />
            <KpiCard
              icon={KPI_ICONS.health}
              label="Health warnings"
              value={healthWarnings}
              tone={healthWarnings > 0 ? 'warn' : undefined}
              sub={`${summary?.lowBatteryCount ?? 0} low battery · ${summary?.poorGpsCount ?? 0} poor GPS`}
            />
          </>
        )}
      </div>

      <div className="command">
        <div className="command-side">
          <Card title="Live map" className="map-panel">
            <div className="map-toolbar" role="group" aria-label="Map filters">
              {MAP_FILTERS.map((filter) => (
                <button key={filter} className={mapFilter === filter ? 'chip active' : 'chip'} onClick={() => setMapFilter(filter)} aria-pressed={mapFilter === filter}>
                  {filter[0].toUpperCase() + filter.slice(1)}
                </button>
              ))}
              <span className="spacer" />
              <select value={tiles} onChange={(event) => setTiles(event.target.value as TileLayerKey)} aria-label="Map style" style={{ width: 'auto' }}>
                {TILE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button className="outline" onClick={() => setFitSignal((signal) => signal + 1)} title="Fit all technicians in view">
                Locate
              </button>
              <button className="outline" onClick={toggleFullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen map'} aria-pressed={fullscreen}>
                {fullscreen ? 'Exit' : 'Fullscreen'}
              </button>
            </div>
            <div className="map-wrap" ref={mapWrapRef}>
              {loading ? (
                <Spinner label="Loading live positions…" />
              ) : (
                <LiveMap
                  devices={filtered}
                  tiles={tiles}
                  fitSignal={fitSignal}
                  onSelect={(device) => setSelected(devices.find((entry) => entry.id === device.id) ?? null)}
                  height={560}
                />
              )}
            </div>
            <div className="map-legend" aria-label="Map legend">
              <span><span className="legend-dot legend-moving" />Moving</span>
              <span><span className="legend-dot legend-idle" />Idle</span>
              <span><span className="legend-dot legend-offline" />Offline</span>
            </div>
            {selected && (
              <div className="map-selected">
                <div className="map-selected-head">
                  <Avatar name={selected.technician?.name ?? selected.deviceName} />
                  <div className="who">
                    <strong>{selected.technician?.name ?? 'Unassigned'}</strong>
                    <small>
                      {selected.technician?.employeeNumber} · {selected.deviceName}
                    </small>
                  </div>
                  <Badge tone={statusOf(selected).state === 'offline' ? 'muted' : statusOf(selected).state === 'moving' ? 'good' : 'warn'}>
                    {statusOf(selected).state === 'offline' ? 'Offline' : statusOf(selected).state === 'moving' ? 'Moving' : 'Idle'}
                  </Badge>
                </div>
                <div className="map-selected-metrics">
                  <span><strong>{Math.round(selected.lastSpeed ?? 0)}</strong> km/h</span>
                  <span>GPS <strong>±{selected.lastAccuracy != null ? Math.round(selected.lastAccuracy) : '—'} m</strong></span>
                  <span>Battery <strong>{selected.batteryLevel ?? '—'}%</strong></span>
                  <span>{relativeTime(selected.lastSeen)}</span>
                </div>
                <div className="map-detail-actions">
                  <button className="outline" onClick={() => selected.technician && navigate(`/technicians/${selected.technician.id}`)}>
                    View technician
                  </button>
                  <button className="outline" onClick={() => selected.technician && navigate(`/trips?technicianId=${selected.technician.id}`)}>
                    Trip history
                  </button>
                </div>
              </div>
            )}
          </Card>

          <Card title="Today's trips" action={<Link to="/trips" className="link">View all →</Link>}>
            {todayTrips.length === 0 && !loading && <EmptyState title="No trips today yet" detail="Trips appear here automatically once movement ends." />}
            {todayTrips.length > 0 && (
              <div>
                <div className="trips-table-head" aria-hidden="true">
                  <span>#</span><span>Technician</span><span>Start</span><span>End</span><span>Duration</span><span>Distance</span><span>Status</span>
                </div>
                {todayTrips.map((trip, index) => (
                  <div className="trips-table-row" key={trip.id} onClick={() => navigate(`/trips/${trip.id}`)} role="link" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && navigate(`/trips/${trip.id}`)}>
                    <span className="num">{index + 1}</span>
                    <span><strong>{trip.technician?.name ?? 'Unknown'}</strong><small>{trip.technician?.employeeNumber}</small></span>
                    <span>{clock(trip.startedAt)}</span>
                    <span>{trip.endedAt ? clock(trip.endedAt) : '—'}</span>
                    <span>{duration(trip.drivingSeconds)}</span>
                    <span>{kilometers(trip.distanceMeters)}</span>
                    <span><Badge tone={trip.endedAt ? 'good' : 'primary'}>{trip.endedAt ? 'Completed' : 'Ongoing'}</Badge></span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="command-side">
          <Card title="Technicians" action={<Link to="/technicians" className="link">Manage →</Link>} className="roster-card">
            {devices.length === 0 && !loading && <EmptyState title="No paired devices yet" detail="Create a technician and generate a pairing code to get started." />}
            {loading && devices.length === 0 && <SkeletonCard lines={5} />}
            {devices
              .slice()
              .sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? ''))
              .map((device) => {
                const { isOnline, isMoving, state } = statusOf(device);
                return (
                  <div
                    className="tech-row"
                    key={device.id}
                    onClick={() => device.technician && navigate(`/technicians/${device.technician.id}`)}
                    role={device.technician ? 'link' : undefined}
                    tabIndex={device.technician ? 0 : undefined}
                    onKeyDown={(event) => event.key === 'Enter' && device.technician && navigate(`/technicians/${device.technician.id}`)}
                    style={device.technician ? { cursor: 'pointer' } : undefined}
                  >
                    <Avatar name={device.technician?.name ?? device.deviceName} />
                    <div className="tech-info">
                      <strong>{device.technician?.name ?? 'Unassigned'}</strong>
                      <small>
                        {device.deviceName} · {relativeTime(device.lastSeen)}
                      </small>
                    </div>
                    <div className="tech-meta">
                      <strong>{Math.round(device.lastSpeed ?? 0)}</strong>
                      <small>km/h</small>
                      <Badge tone={state === 'offline' ? 'muted' : isMoving ? 'good' : 'warn'}>{state === 'offline' ? 'Offline' : isMoving ? 'Moving' : 'Idle'}</Badge>
                      <Badge tone={batteryTone(device.batteryLevel ?? null)}>{device.batteryLevel ?? '—'}%</Badge>
                    </div>
                  </div>
                );
              })}
          </Card>

          <Card title="Recent activity" action={<Link to="/alerts" className="link">View all →</Link>}>
            {feed.length === 0 && !loading && <EmptyState title="Nothing yet" detail="Trip and alert events will appear here as they happen." />}
            {loading && feed.length === 0 && <SkeletonCard lines={4} />}
            <div className="activity">
              {feed.map((item) => (
                <div className="activity-item" key={item.key}>
                  <span className={`activity-dot ${item.tone}`} aria-hidden="true">
                    {item.kind === 'trip' ? (
                      <svg viewBox="0 0 24 24"><path d="M4 8h13l-3-3" /><path d="M20 16H7l3 3" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></svg>
                    )}
                  </span>
                  <div className="activity-body">
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <span className="activity-time">{relativeTime(item.time)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Alerts" action={<Link to="/alerts" className="link">Manage →</Link>}>
            <AlertsPreview />
          </Card>
        </div>
      </div>
      {located.length === 0 && !loading && devices.length > 0 && (
        <p className="muted">No located positions for the current filter — every device is missing GPS coordinates or is offline.</p>
      )}
    </AppShell>
  );
}

function AlertsPreview() {
  const [alerts, setAlerts] = useState<AlertFeed[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    api<AlertFeed[]>('/api/alerts?acknowledged=false&limit=6')
      .then((result) => active && setAlerts(result))
      .catch(() => undefined)
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, []);

  if (!loaded) return <SkeletonCard lines={3} />;
  if (alerts.length === 0) return <EmptyState title="No unacknowledged alerts" />;
  const tone = { INFO: 'primary', WARNING: 'warn', CRITICAL: 'bad' } as const;
  return (
    <div className="activity">
      {alerts.map((alert) => (
        <div className="activity-item" key={alert.id}>
          <span className={`activity-dot ${tone[alert.severity]}`} aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></svg>
          </span>
          <div className="activity-body">
            <strong>{humanizeAlertType(alert.type)}</strong>
            <small>
              {alert.technician?.name ?? 'Unknown'} · {alert.message}
            </small>
          </div>
          <span className="activity-time">{relativeTime(alert.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}
