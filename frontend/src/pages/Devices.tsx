import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { VEHICLE_ART, type VehicleIconType } from '../components/LiveMap';
import { AppShell, Badge, Card, EmptyState, ErrorNote, Modal, RemoveDialog, Spinner } from '../components/ui';
import { batteryTone, relativeTime } from '../lib/format';
import { useAuth } from '../state/auth';
import { Link } from '../lib/router';

type Device = {
  id: string;
  deviceName: string;
  status: 'PENDING' | 'ACTIVE' | 'DISABLED';
  manufacturer: string | null;
  model: string | null;
  androidVersion: string | null;
  appVersion: string | null;
  batteryLevel: number | null;
  lastAccuracy: number | null;
  lastSpeed: number | null;
  lastSeen: string | null;
  unpairedAt: string | null;
  iconType?: string | null;
  iconColor?: string | null;
  technician: { id: string; name: string; employeeNumber: string } | null;
};

type IconType = VehicleIconType;

const ICON_OPTIONS: { type: IconType; label: string }[] = [
  { type: 'pin', label: 'Pin' },
  { type: 'car', label: 'Car' },
  { type: 'motorcycle', label: 'Motorcycle' },
];

/** Grey used for unselected options — a fixed hex so it works inside SVG fill. */
const INACTIVE_FILL = '#94a3b8';

function IconPickerDialog({ device, onClose, onSaved }: { device: Device; onClose: () => void; onSaved: () => void }) {
  const [iconType, setIconType] = useState<IconType>((device.iconType as IconType) || 'pin');
  const [iconColor, setIconColor] = useState(device.iconColor || '#38bdf8');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      await api(`/api/devices/${device.id}`, {
        method: 'PATCH',
        body: { iconType, iconColor },
      });
      onSaved();
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Failed to update icon');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Icon for ${device.deviceName}`} onClose={onClose}>
      <div className="icon-picker">
        <p className="icon-picker-label">Vehicle type</p>
        <div className="icon-picker-options">
          {ICON_OPTIONS.map((option) => (
            <button
              key={option.type}
              className={`icon-picker-option ${iconType === option.type ? 'active' : ''}`}
              onClick={() => setIconType(option.type)}
              type="button"
              aria-pressed={iconType === option.type}
            >
              <svg viewBox={VEHICLE_ART[option.type].viewBox}>
                <g dangerouslySetInnerHTML={{ __html: VEHICLE_ART[option.type].art(iconType === option.type ? iconColor : INACTIVE_FILL) }} />
              </svg>
              <span>{option.label}</span>
            </button>
          ))}
        </div>

        <p className="icon-picker-label">Color</p>
        <div className="icon-picker-color">
          <input type="color" value={iconColor} onChange={(event) => setIconColor(event.target.value)} className="icon-color-input" />
          <span className="icon-color-value">{iconColor}</span>
          <button type="button" className="link" onClick={() => setIconColor('#38bdf8')}>Reset</button>
        </div>

        <p className="icon-picker-label">Preview</p>
        <div className="icon-picker-preview">
          <svg viewBox={VEHICLE_ART[iconType].viewBox} width="64" height="64">
            <g dangerouslySetInnerHTML={{ __html: VEHICLE_ART[iconType].art(iconColor) }} />
          </svg>
        </div>

        <ErrorNote message={error} />
        <div className="icon-picker-actions">
          <button className="outline" onClick={onClose} type="button">Cancel</button>
          <button className="primary" onClick={() => void save()} disabled={busy} type="button">
            {busy ? 'Saving…' : 'Save icon'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function health(device: Device): { label: string; tone: 'good' | 'warn' | 'bad' | 'muted' } {
  if (device.status !== 'ACTIVE') return { label: device.status === 'PENDING' ? 'Awaiting pairing' : 'Unpaired', tone: 'muted' };
  if (!device.lastSeen) return { label: 'Never connected', tone: 'muted' };
  const minutes = (Date.now() - new Date(device.lastSeen).getTime()) / 60000;
  if (minutes < 5) return { label: 'Online', tone: 'good' };
  if (minutes < 30) return { label: 'Delayed', tone: 'warn' };
  return { label: 'Offline', tone: 'bad' };
}

export function DevicesPage() {
  const { user } = useAuth();
  const canRemove = user?.role === 'SUPERADMIN' || user?.role === 'ADMIN';
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [codeFor, setCodeFor] = useState<{ device: Device; code: string; adminPassword: string } | null>(null);
  const [removing, setRemoving] = useState<Device | null>(null);
  const [iconFor, setIconFor] = useState<Device | null>(null);

  const filtered = devices.filter((device) =>
    `${device.deviceName} ${device.technician?.name ?? ''} ${device.technician?.employeeNumber ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  );

  const load = async () => {
    try {
      setDevices(await api<Device[]>('/api/devices'));
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Failed to load devices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function unpair(device: Device) {
    try {
      await api(`/api/devices/${device.id}/unpair`, { method: 'POST' });
      await load();
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Failed to unpair device');
    }
  }

  async function regenerate(device: Device) {
    try {
      const result = await api<{ pairingCode: string; adminPassword: string }>(`/api/devices/${device.id}/pairing-code`, { method: 'POST' });
      setCodeFor({ device, code: result.pairingCode, adminPassword: result.adminPassword });
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Failed to generate pairing code');
    }
  }

  return (
    <AppShell
      title="Devices"
      subtitle="DEVICE HEALTH"
      actions={<Link to="/android-setup" className="outline as-button">Android setup guide</Link>}
    >
      <ErrorNote message={error} />
      <Card
        title={`${filtered.length} device${filtered.length === 1 ? '' : 's'}`}
        action={<input className="search" placeholder="Search devices" aria-label="Search devices" value={search} onChange={(event) => setSearch(event.target.value)} />}
        className="cards-mobile"
      >
        {loading && <Spinner />}
        {!loading && filtered.length === 0 && <EmptyState title="No devices" detail="Devices appear here after you generate a pairing code for a technician." />}
        <div className="table-wrap">
          {filtered.length > 0 && (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Device</th>
                  <th>Technician</th>
                  <th>Status</th>
                  <th>Battery</th>
                  <th>GPS</th>
                  <th>Last seen</th>
                  <th>Build</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((device) => {
                  const state = health(device);
                  return (
                    <tr key={device.id}>
                      <td data-label="Device">
                        <strong>{device.deviceName}</strong>
                        <small>
                          {[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Unknown model'}
                        </small>
                      </td>
                      <td data-label="Technician">{device.technician ? `${device.technician.name} (${device.technician.employeeNumber})` : <span className="muted">Unassigned</span>}</td>
                      <td data-label="Status">
                        <Badge tone={state.tone}>{state.label}</Badge>
                      </td>
                      <td data-label="Battery">
                        <Badge tone={batteryTone(device.batteryLevel)}>{device.batteryLevel ?? '—'}%</Badge>
                      </td>
                      <td data-label="GPS">{device.lastAccuracy != null ? `±${Math.round(device.lastAccuracy)} m` : '—'}</td>
                      <td data-label="Last seen">{relativeTime(device.lastSeen)}</td>
                      <td data-label="Build">
                        <small>
                          Android {device.androidVersion ?? '—'} · v{device.appVersion ?? '—'}
                        </small>
                      </td>
                      <td className="row-actions actions no-label">
                        <button className="link" onClick={() => setIconFor(device)} title="Change map icon">
                          Icon
                        </button>
                        <button className="link" onClick={() => void regenerate(device)} title="Generate a new pairing code">
                          Code
                        </button>
                        {device.status === 'ACTIVE' && (
                          <button className="link" onClick={() => void unpair(device)} title="Unpair but keep the GPS history">
                            Unpair
                          </button>
                        )}
                        {canRemove && (
                          <button className="link danger" onClick={() => setRemoving(device)} title="Remove this device">
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {codeFor && (
        <Modal title={`Pairing code for ${codeFor.device.deviceName}`} onClose={() => setCodeFor(null)}>
          <div className="pairing-code">
            <small>SINGLE-USE · EXPIRES IN 15 MINUTES</small>
            <strong>{codeFor.code}</strong>
          </div>
          <div className="pairing-code">
            <small>DEVICE ADMIN PASSWORD · SHOWN ONCE</small>
            <strong>{codeFor.adminPassword}</strong>
          </div>
          <p className="muted">Enter the code in the Android app on the technician's phone. Previous unused codes have been invalidated. Save the admin password now — it unlocks the phone's settings and cannot be shown again.</p>
        </Modal>
      )}

      {iconFor && (
        <IconPickerDialog
          device={iconFor}
          onClose={() => setIconFor(null)}
          onSaved={() => { setIconFor(null); void load(); }}
        />
      )}

      {removing && (
        <RemoveDialog
          title="Remove device"
          subject={`${removing.deviceName}${removing.technician ? ` · ${removing.technician.name}` : ''}`}
          consequence="The device is unregistered and its token is revoked immediately, so the phone can no longer upload. Pair a new phone whenever you are ready."
          remove={async (purge) => {
            await api(`/api/devices/${removing.id}${purge ? '?purge=true' : ''}`, { method: 'DELETE' });
          }}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            void load();
          }}
        />
      )}
    </AppShell>
  );
}
