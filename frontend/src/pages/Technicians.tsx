import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AppShell, Avatar, Badge, Card, EmptyState, ErrorNote, Field, Modal, RemoveDialog, Spinner } from '../components/ui';
import { Link, useRouter } from '../lib/router';
import { relativeTime } from '../lib/format';
import { useAuth } from '../state/auth';

type DeviceSummary = { id: string; deviceName: string; status: string; batteryLevel: number | null; lastSeen: string | null };
export type Technician = {
  id: string;
  name: string;
  employeeNumber: string;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'DISABLED';
  devices: DeviceSummary[];
};

export function TechniciansPage() {
  const { user } = useAuth();
  const { query, navigate } = useRouter();
  const canRemove = user?.role === 'SUPERADMIN' || user?.role === 'ADMIN';
  const [removing, setRemoving] = useState<Technician | null>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(query.get('search') ?? '');

  useEffect(() => {
    const fromUrl = query.get('search') ?? '';
    if (fromUrl) setSearch(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.toString()]);
  const [showCreate, setShowCreate] = useState(false);
  const [pairingTarget, setPairingTarget] = useState<Technician | null>(null);
  const [pairingCode, setPairingCode] = useState('');
  const [deviceAdminPassword, setDeviceAdminPassword] = useState('');
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [deviceName, setDeviceName] = useState('');

  const load = async () => {
    try {
      setTechnicians(await api<Technician[]>('/api/technicians'));
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Failed to load technicians');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function toggleStatus(technician: Technician) {
    setError('');
    try {
      await api(`/api/technicians/${technician.id}`, {
        method: 'PATCH',
        body: { status: technician.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' },
      });
      await load();
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Could not update the technician');
    }
  }

  async function generateCode(event: React.FormEvent) {
    event.preventDefault();
    if (!pairingTarget) return;
    setError('');
    try {
      const result = await api<{ pairingCode: string; adminPassword: string }>('/api/devices/pairing-code', {
        method: 'POST',
        body: {
          technicianId: pairingTarget.id,
          deviceName: deviceName || `DEVICE-${pairingTarget.employeeNumber}`,
          ...(adminPasswordInput.trim() ? { adminPassword: adminPasswordInput.trim() } : {}),
        },
      });
      setPairingCode(result.pairingCode);
      setDeviceAdminPassword(result.adminPassword);
      await load();
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Failed to generate a pairing code');
    }
  }

  const filtered = technicians.filter((technician) =>
    `${technician.name} ${technician.employeeNumber} ${technician.email ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <AppShell
      title="Technicians"
      subtitle="FIELD STAFF"
      actions={
        <>
          <Link to="/android-setup" className="outline as-button">Android setup guide</Link>
          <button className="primary" onClick={() => setShowCreate(true)}>
            Add technician
          </button>
        </>
      }
    >
      <ErrorNote message={error} />
      <Card
        title={`${filtered.length} technician${filtered.length === 1 ? '' : 's'}`}
        action={<input className="search" placeholder="Search name or employee number" value={search} onChange={(event) => setSearch(event.target.value)} />}
      >
        {loading && <Spinner />}
        {!loading && filtered.length === 0 && <EmptyState title="No technicians yet" detail="Add a technician, then generate a pairing code for their phone." />}
        {filtered.map((technician) => {
          const device = technician.devices[0];
          return (
            <div
              className="tech-row"
              key={technician.id}
              onClick={() => navigate(`/technicians/${technician.id}`)}
              role="link"
              tabIndex={0}
              onKeyDown={(event) => event.key === 'Enter' && navigate(`/technicians/${technician.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <Avatar name={technician.name} />
              <div className="tech-info">
                <strong>{technician.name}</strong>
                <small>
                  {technician.employeeNumber}
                  {technician.phone ? ` · ${technician.phone}` : ''}
                </small>
              </div>
              <div className="tech-meta">
                {device ? (
                  <Badge tone={device.status === 'ACTIVE' ? 'good' : device.status === 'PENDING' ? 'warn' : 'muted'}>{device.status}</Badge>
                ) : (
                  <Badge tone="muted">No device</Badge>
                )}
                <Badge tone={technician.status === 'ACTIVE' ? 'good' : 'bad'}>{technician.status}</Badge>
                <small>{device ? relativeTime(device.lastSeen) : ''}</small>
              </div>
              <div className="row-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                <button
                  className="outline"
                  onClick={() => {
                    setPairingTarget(technician);
                    setPairingCode('');
                    setDeviceName(`${technician.employeeNumber.replace(/[^A-Za-z0-9]/g, '-')}-PHONE`);
                  }}
                >
                  Pair device
                </button>
                <button className="link" onClick={() => void toggleStatus(technician)} title="Deactivate or reactivate this technician">
                  {technician.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                </button>
                {canRemove && (
                  <button className="link danger" onClick={() => setRemoving(technician)} title="Remove this technician">
                    Remove
                  </button>
                )}
                <Link to={`/technicians/${technician.id}`} className="link">
                  Open →
                </Link>
              </div>
            </div>
          );
        })}
      </Card>

      {showCreate && <CreateTechnicianModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(); }} />}
      {removing && (
        <RemoveDialog
          title="Remove technician"
          subject={`${removing.name} · ${removing.employeeNumber}`}
          consequence="The technician disappears from the roster and their linked devices are detached, so the phone can no longer upload. Deactivating instead keeps them listed with their history."
          remove={async (purge) => {
            await api(`/api/technicians/${removing.id}${purge ? '?purge=true' : ''}`, { method: 'DELETE' });
          }}
          onClose={() => setRemoving(null)}
          onRemoved={() => {
            setRemoving(null);
            void load();
          }}
        />
      )}

      {pairingTarget && (
        <Modal title={`Pair a device for ${pairingTarget.name}`} onClose={() => setPairingTarget(null)}>
          <form onSubmit={generateCode} className="stack">
            <p className="muted">
              Enter the device name, generate a code, then type the code into the Android app. Codes expire in 15 minutes and can only be used once.
            </p>
            <Field label="Device name">
              <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} required />
            </Field>
            <Field label="Device admin password (optional)">
              <input
                value={adminPasswordInput}
                onChange={(event) => setAdminPasswordInput(event.target.value)}
                placeholder="Leave blank for an auto-generated PIN"
                autoComplete="off"
              />
            </Field>
            {pairingCode && (
              <div className="pairing-code">
                <small>PAIRING CODE</small>
                <strong>{pairingCode}</strong>
              </div>
            )}
            {deviceAdminPassword && (
              <div className="pairing-code">
                <small>DEVICE ADMIN PASSWORD · SHOWN ONCE</small>
                <strong>{deviceAdminPassword}</strong>
                <p className="muted">The phone's settings are locked behind this password. Save it now — it cannot be shown again.</p>
              </div>
            )}
            <button className="primary">{pairingCode ? 'Generate another code' : 'Generate pairing code'}</button>
          </form>
        </Modal>
      )}
    </AppShell>
  );
}

function CreateTechnicianModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', employeeNumber: '', email: '', phone: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/technicians', {
        method: 'POST',
        body: {
          name: form.name,
          employeeNumber: form.employeeNumber,
          ...(form.email ? { email: form.email } : {}),
          ...(form.phone ? { phone: form.phone } : {}),
        },
      });
      onCreated();
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Could not create technician');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add technician" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <Field label="Full name">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
        </Field>
        <Field label="Employee number" hint="Unique within your organization, e.g. TECH-JUAN-001">
          <input value={form.employeeNumber} onChange={(event) => setForm({ ...form, employeeNumber: event.target.value })} required />
        </Field>
        <div className="grid two">
          <Field label="Email (optional)">
            <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          </Field>
          <Field label="Phone (optional)">
            <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </Field>
        </div>
        <ErrorNote message={error} />
        <button className="primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create technician'}
        </button>
      </form>
    </Modal>
  );
}
