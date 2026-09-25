import React, { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export type MapDevice = {
  id: string;
  deviceName: string;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastSpeed: number | null;
  lastAccuracy: number | null;
  batteryLevel?: number | null;
  lastSeen?: string | null;
  iconType?: string | null;
  iconColor?: string | null;
  technician?: { id: string; name: string; employeeNumber: string } | null;
};

export type LatLng = [number, number];

/** A motionless place to draw as a pin: label = duration, detail = arrived → departed. */
export type MapStop = {
  id: string;
  position: LatLng;
  label: string;
  detail?: string;
  open?: boolean;
};

const STATUS_COLORS = {
  moving: '#22c55e',
  idle: '#f59e0b',
  offline: '#94a3b8',
} as const;

export type VehicleIconType = 'pin' | 'car' | 'motorcycle';

type IconType = VehicleIconType;

const DARK_TYRE = '#1e293b';
const GLASS = '#ffffff';

/**
 * Top-down vehicle artwork shared by the live map and the Devices icon picker.
 * The body fill is always the user-chosen color; tyres stay fixed dark so they
 * read on any tile layer, and glass stays white.
 */
export const VEHICLE_ART: Record<VehicleIconType, { viewBox: string; art: (fill: string) => string }> = {
  pin: {
    viewBox: '0 0 24 24',
    art: (fill) => `<circle cx="12" cy="12" r="7" fill="${fill}"/><circle cx="12" cy="12" r="2.6" fill="${GLASS}"/>`,
  },
  car: {
    viewBox: '0 0 24 36',
    art: (fill) => [
      `<rect x="1.6" y="7" width="3.4" height="7" rx="1.2" fill="${DARK_TYRE}"/>`,
      `<rect x="19" y="7" width="3.4" height="7" rx="1.2" fill="${DARK_TYRE}"/>`,
      `<rect x="1.6" y="22" width="3.4" height="7" rx="1.2" fill="${DARK_TYRE}"/>`,
      `<rect x="19" y="22" width="3.4" height="7" rx="1.2" fill="${DARK_TYRE}"/>`,
      `<rect x="5" y="2" width="14" height="32" rx="5.5" fill="${fill}"/>`,
      `<path d="M7.6 12.6h8.8V9a2.2 2.2 0 0 0-2.2-2.2H9.8a2.2 2.2 0 0 0-2.2 2.2v3.6z" fill="${GLASS}"/>`,
      `<rect x="7.6" y="15" width="8.8" height="6" rx="1.6" fill="${GLASS}" opacity="0.9"/>`,
      `<path d="M7.6 23.4h8.8v3.8a2.2 2.2 0 0 1-2.2 2.2H9.8a2.2 2.2 0 0 1-2.2-2.2v-3.8z" fill="${GLASS}"/>`,
    ].join(''),
  },
  motorcycle: {
    viewBox: '0 0 24 36',
    art: (fill) => [
      `<ellipse cx="12" cy="5.6" rx="3.1" ry="4.1" fill="${DARK_TYRE}"/>`,
      `<ellipse cx="12" cy="30.4" rx="3.1" ry="4.1" fill="${DARK_TYRE}"/>`,
      `<rect x="9.3" y="8.5" width="5.4" height="19" rx="2.7" fill="${fill}"/>`,
      `<rect x="10.4" y="13" width="3.2" height="5.4" rx="1.2" fill="${GLASS}"/>`,
      `<circle cx="12" cy="22.5" r="1.4" fill="${GLASS}"/>`,
    ].join(''),
  },
};

function vehicleIcon(type: IconType, fill: string, status: 'moving' | 'idle' | 'offline'): L.DivIcon {
  const ring = STATUS_COLORS[status];
  const shape = VEHICLE_ART[type];
  return L.divIcon({
    className: 'pin',
    html: `<span class="vehicle-dot" style="--ring:${ring}"><svg viewBox="${shape.viewBox}">${shape.art(fill)}</svg></span>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}

function Recenter({ center, zoom }: { center: LatLng; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (Number.isFinite(center[0]) && Number.isFinite(center[1])) map.setView(center, zoom ?? map.getZoom(), { animate: true });
  }, [center, zoom, map]);
  return null;
}

function FitBounds({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng))), { padding: [40, 40] });
    else if (points.length === 1) map.setView(points[0], 14, { animate: true });
  }, [points, map]);
  return null;
}

export const TILES = {
  standard: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors' },
  humanitarian: { url: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', attribution: '&copy; OpenStreetMap contributors, Tiles style by Humanitarian OpenStreetMap Team' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics' },
};

export type TileLayerKey = keyof typeof TILES;

function brandPrimary(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  return value || '#0ea5e9';
}

function FitAll({ points, signal }: { points: LatLng[]; signal: number }) {
  const map = useMap();
  const lastSignal = useRef(0);
  useEffect(() => {
    if (signal > lastSignal.current && points.length > 0) {
      lastSignal.current = signal;
      if (points.length > 1) map.fitBounds(L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng))), { padding: [40, 40] });
      else map.setView(points[0], 14, { animate: true });
    }
  }, [signal, points, map]);
  return null;
}

type Props = {
  devices?: MapDevice[];
  center?: LatLng;
  zoom?: number;
  route?: LatLng[];
  stops?: MapStop[];
  playback?: { position: LatLng; heading?: number | null; label: string; iconType?: string | null; iconColor?: string | null } | null;
  fitRoute?: boolean;
  height?: number;
  tiles?: TileLayerKey;
  fitSignal?: number;
  onSelect?: (device: MapDevice) => void;
};

function playbackIcon(heading?: number | null, iconType?: string | null, iconColor?: string | null) {
  const rotation = Number.isFinite(heading) ? Number(heading) : 0;
  const fill = iconColor || '#1e293b';
  const type = (iconType as IconType) || 'pin';
  const shape = VEHICLE_ART[type];
  const spin = type === 'pin' ? '' : `transform:rotate(${rotation}deg);`;
  return L.divIcon({
    className: 'playback-marker',
    html: `<span class="replay-vehicle" style="${spin}"><svg viewBox="${shape.viewBox}">${shape.art(fill)}</svg></span>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}

function stopIcon(open?: boolean): L.DivIcon {
  return L.divIcon({
    className: 'stop-pin',
    html: `<span class="stop-dot${open ? ' stop-dot-open' : ''}"></span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

export function LiveMap({ devices = [], center, zoom = 11, route, stops = [], playback, fitRoute = false, height = 560, tiles = 'standard', fitSignal = 0, onSelect }: Props) {
  const located = devices.filter((device) => device.lastLatitude != null && device.lastLongitude != null);
  const fallback: LatLng = center ?? (located.length ? [located[0].lastLatitude!, located[0].lastLongitude!] : [10.3157, 123.8854]);
  const now = Date.now();
  const onlineWindow = 5 * 60 * 1000;
  const layer = TILES[tiles];
  const primary = useMemo(() => brandPrimary(), []);

  return (
    <div className="map" style={{ height: `var(--map-h, ${height}px)` }}>
      <MapContainer center={fallback} zoom={zoom} scrollWheelZoom className="leaflet-container">
        <TileLayer attribution={layer.attribution} url={layer.url} />
        {route && route.length > 1 && <Polyline positions={route} pathOptions={{ color: primary, weight: 4, opacity: 0.85 }} />}
        {fitRoute && route && route.length > 0 && <FitBounds points={route} />}
        {!fitRoute && fitSignal === 0 && located.length === 1 && <Recenter center={[located[0].lastLatitude!, located[0].lastLongitude!]} />}
        <FitAll points={located.map((device) => [device.lastLatitude!, device.lastLongitude!] as LatLng)} signal={fitSignal} />
        {located.map((device) => {
          const isOnline = device.lastSeen ? now - new Date(device.lastSeen).getTime() < onlineWindow : false;
          const isMoving = isOnline && (device.lastSpeed ?? 0) >= 3;
          const status = isMoving ? 'moving' : isOnline ? 'idle' : 'offline';
          const fill = device.iconColor || STATUS_COLORS[status];
          const icon = vehicleIcon((device.iconType as IconType) || 'pin', fill, status);
          return (
            <Marker
              key={device.id}
              position={[device.lastLatitude!, device.lastLongitude!]}
              icon={icon}
              eventHandlers={{ click: () => onSelect?.(device) }}
            >
              <Popup>
                <strong>{device.technician?.name ?? device.deviceName}</strong>
                <br />
                {isMoving ? `Moving · ${Math.round(device.lastSpeed ?? 0)} km/h` : isOnline ? 'Idle / stopped' : 'Offline'}
                <br />
                Battery {device.batteryLevel ?? '—'}% · GPS ±{device.lastAccuracy != null ? Math.round(device.lastAccuracy) : '—'} m
                <br />
                <span className="muted">{device.deviceName}</span>
              </Popup>
            </Marker>
          );
        })}
        {stops.map((stop) => (
          <Marker key={stop.id} position={stop.position} icon={stopIcon(stop.open)}>
            <Popup>
              <strong>{stop.label}</strong>
              {stop.detail && (
                <>
                  <br />
                  <span className="muted">{stop.detail}</span>
                </>
              )}
            </Popup>
          </Marker>
        ))}
        {playback && (
          <Marker position={playback.position} icon={playbackIcon(playback.heading, playback.iconType, playback.iconColor)}>
            <Popup>{playback.label}</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
}
