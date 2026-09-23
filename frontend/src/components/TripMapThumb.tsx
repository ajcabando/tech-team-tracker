import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, Polyline, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api';
import { LatLng, TILES } from './LiveMap';

type RoutePoint = { latitude: number; longitude: number };

const MAX_POINTS = 60;
const FALLBACK_CENTER: LatLng = [10.3157, 123.8854];

function downsample(points: RoutePoint[]): LatLng[] {
  if (points.length <= MAX_POINTS) return points.map((point) => [point.latitude, point.longitude] as LatLng);
  const step = Math.ceil(points.length / MAX_POINTS);
  const sampled: LatLng[] = [];
  for (let index = 0; index < points.length; index += step) {
    sampled.push([points[index].latitude, points[index].longitude]);
  }
  const last = points[points.length - 1];
  const lastSampled = sampled[sampled.length - 1];
  if (lastSampled[0] !== last.latitude || lastSampled[1] !== last.longitude) {
    sampled.push([last.latitude, last.longitude]);
  }
  return sampled;
}

function FitThumb({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) {
      map.fitBounds(L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng))), { padding: [6, 6], animate: false });
    } else if (points.length === 1) {
      map.setView(points[0], 13, { animate: false });
    }
  }, [points, map]);
  return null;
}

function primaryColor(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  return value || '#0ea5e9';
}

type Props = {
  tripId: string;
  start?: [number, number] | null;
  end?: [number, number] | null;
};

/** Tiny non-interactive map preview of a trip route. Fetches the route lazily when scrolled into view. */
export function TripMapThumb({ tripId, start, end }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [route, setRoute] = useState<LatLng[] | null>(null);
  const [failed, setFailed] = useState(false);
  const primary = useMemo(() => primaryColor(), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || route || failed) return;
    let cancelled = false;
    api<RoutePoint[]>(`/api/trips/${tripId}/route`)
      .then((points) => {
        if (cancelled) return;
        if (points.length) setRoute(downsample(points));
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, tripId, route, failed]);

  const fallbackLine: LatLng[] =
    start && end && start[0] !== end[0] && start[1] !== end[1] ? [start, end] : start ? [start] : [];
  const drawn = route ?? (failed ? (fallbackLine.length ? fallbackLine : null) : null);
  const center: LatLng = drawn && drawn.length ? drawn[0] : start ?? FALLBACK_CENTER;

  return (
    <div className={`trip-thumb${drawn || failed ? '' : ' is-loading'}`} ref={hostRef} aria-hidden="true">
      {visible && (
        <MapContainer
          center={center}
          zoom={13}
          className="leaflet-container"
          dragging={false}
          scrollWheelZoom={false}
          zoomControl={false}
          attributionControl={false}
          doubleClickZoom={false}
          keyboard={false}
          touchZoom={false}
          boxZoom={false}
        >
          <TileLayer url={TILES.standard.url} />
          {drawn && drawn.length > 1 && <Polyline positions={drawn} pathOptions={{ color: primary, weight: 3, opacity: 0.9 }} />}
          {drawn && drawn.length > 0 && <FitThumb points={drawn} />}
        </MapContainer>
      )}
    </div>
  );
}
