import React, { useEffect, useRef, useState } from 'react';
import { api, uploadAsset } from '../lib/api';
import { AppShell, Card, ErrorNote, Field, PasswordInput, Spinner } from '../components/ui';
import { Branding, useAuth } from '../state/auth';
import { ThemeMode, useTheme } from '../state/theme';
import { BUILD_INFO } from '../buildInfo';
import { onErrorsChange, recentErrors } from '../lib/diagnostics';

type Tracking = {
  movingIntervalSeconds: number;
  walkingIntervalSeconds: number;
  stationaryIntervalSeconds: number;
  lowBatteryIntervalSeconds: number;
  stopTimeoutSeconds: number;
  automaticTripDetection: boolean;
  gpsAccuracyThresholdMeters: number;
  stopClusterRadiusMeters: number;
  lowBatteryThreshold: number;
};

type Retention = { rawLocationDays: number; tripDays: number; auditLogDays: number };
type Health = { status: string; database: string; version: string; uptimeSeconds: number; subscribers: number };

const THEME_OPTIONS: Array<{ mode: ThemeMode; label: string; hint: string }> = [
  { mode: 'light', label: 'Light', hint: 'Bright workspace' },
  { mode: 'dark', label: 'Dark', hint: 'Low-light command center' },
  { mode: 'system', label: 'System', hint: 'Follow this device' },
];

export function SettingsPage() {
  const { user, branding, setBranding, reloadBranding } = useAuth();
  const { mode, setMode } = useTheme();
  const canEdit = user?.role === 'SUPERADMIN' || user?.role === 'ADMIN';
  const [tracking, setTracking] = useState<Tracking | null>(null);
  const [retention, setRetention] = useState<Retention | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<'logo' | 'background' | null>(null);

  useEffect(() => {
    void Promise.all([
      api<Tracking>('/api/settings/tracking').then(setTracking).catch(() => undefined),
      api<Retention>('/api/settings/retention').then(setRetention).catch(() => undefined),
      // Health endpoints live at /health, not under /api.
      api<Health>('/health', { auth: false }).then(setHealth).catch(() => undefined),
    ]);
  }, []);

  async function saveBranding(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const updated = await api<Branding>('/api/settings', { method: 'POST', body: branding });
      setBranding(updated);
      await reloadBranding();
      setMessage('Branding saved. The interface updated immediately.');
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Could not save branding');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(kind: 'logo' | 'background', event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    // Fail fast with a specific message instead of depending on proxy/backend
    // limits surfacing as generic errors. Caps mirror the server multer limits.
    const maxBytes = kind === 'logo' ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      const label = kind === 'logo' ? 'Logo' : 'Login background';
      setError(`${label} must be under ${Math.round(maxBytes / 1024 / 1024)} MB — this file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
      return;
    }
    setUploading(kind);
    setError('');
    try {
      const updated = (await uploadAsset(kind, file)) as Branding;
      setBranding(updated);
      await reloadBranding();
      setMessage(`${kind === 'logo' ? 'Logo' : 'Login background'} uploaded.`);
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? `Upload failed`);
    } finally {
      setUploading(null);
    }
  }

  async function saveTracking(event: React.FormEvent) {
    event.preventDefault();
    if (!tracking) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setTracking(await api<Tracking>('/api/settings/tracking', { method: 'PUT', body: tracking }));
      setMessage('Tracking settings saved. Android devices pick these up on their next configuration sync.');
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Could not save tracking settings');
    } finally {
      setBusy(false);
    }
  }

  async function saveRetention(event: React.FormEvent) {
    event.preventDefault();
    if (!retention) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      setRetention(await api<Retention>('/api/settings/retention', { method: 'PUT', body: retention }));
      setMessage('Retention settings saved.');
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Could not save retention settings');
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api('/api/auth/change-password', { method: 'POST', body: password });
      setPassword({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setMessage('Password changed. Other sessions were signed out.');
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Could not change password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Settings" subtitle="CONFIGURATION">
      <ErrorNote message={error} />
      {message && <p className="success-note">{message}</p>}

      <Card title="Appearance" action={<span className="muted">Applies to this browser immediately</span>}>
        <p className="settings-section">Theme</p>
        <div className="segmented" role="radiogroup" aria-label="Color theme">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.mode}
              role="radio"
              aria-checked={mode === option.mode}
              className={mode === option.mode ? 'active' : ''}
              onClick={() => setMode(option.mode)}
              title={option.hint}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="muted">{THEME_OPTIONS.find((option) => option.mode === mode)?.hint}</p>
      </Card>

      <div className="grid two-cards">
        <Card title="Branding">
          {!canEdit && <p className="muted">Only administrators can change branding.</p>}
          <form onSubmit={saveBranding} className="stack">
            <div className="grid two">
              <Field label="Application name">
                <input value={branding.applicationName} onChange={(event) => setBranding({ ...branding, applicationName: event.target.value })} disabled={!canEdit} />
              </Field>
              <Field label="Company name">
                <input value={branding.companyName} onChange={(event) => setBranding({ ...branding, companyName: event.target.value })} disabled={!canEdit} />
              </Field>
              <Field label="Primary color">
                <input type="color" value={branding.primaryColor} onChange={(event) => setBranding({ ...branding, primaryColor: event.target.value })} disabled={!canEdit} />
              </Field>
              <Field label="Secondary color">
                <input type="color" value={branding.secondaryColor} onChange={(event) => setBranding({ ...branding, secondaryColor: event.target.value })} disabled={!canEdit} />
              </Field>
              <Field label="Logo">
                <div className="upload-row">
                  {branding.logoUrl && <img src={branding.logoUrl} alt="Logo preview" className="upload-preview" />}
                  <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" onChange={(event) => void handleUpload('logo', event)} />
                  <div className="upload-actions">
                    <button type="button" className="outline" onClick={() => logoInputRef.current?.click()} disabled={!canEdit || uploading === 'logo'}>
                      {uploading === 'logo' ? 'Uploading…' : branding.logoUrl ? 'Replace logo' : 'Upload logo'}
                    </button>
                    {branding.logoUrl && canEdit && (
                      <button type="button" className="link danger" onClick={() => setBranding({ ...branding, logoUrl: null })}>Remove</button>
                    )}
                  </div>
                </div>
              </Field>
              <Field label="Login background">
                <div className="upload-row upload-row-bg">
                  {branding.loginBackgroundUrl && <img src={branding.loginBackgroundUrl} alt="Background preview" className="upload-preview-bg" />}
                  <input ref={bgInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void handleUpload('background', event)} />
                  <div className="upload-actions">
                    <button type="button" className="outline" onClick={() => bgInputRef.current?.click()} disabled={!canEdit || uploading === 'background'}>
                      {uploading === 'background' ? 'Uploading…' : branding.loginBackgroundUrl ? 'Replace background' : 'Upload background'}
                    </button>
                    {branding.loginBackgroundUrl && canEdit && (
                      <button type="button" className="link danger" onClick={() => setBranding({ ...branding, loginBackgroundUrl: null })}>Remove</button>
                    )}
                  </div>
                </div>
              </Field>
              <Field label="Timezone">
                <input value={branding.timezone ?? ''} onChange={(event) => setBranding({ ...branding, timezone: event.target.value })} disabled={!canEdit} />
              </Field>
              <Field label="Support email">
                <input value={branding.supportEmail ?? ''} onChange={(event) => setBranding({ ...branding, supportEmail: event.target.value })} disabled={!canEdit} />
              </Field>
              <Field label="Support phone">
                <input value={branding.supportPhone ?? ''} onChange={(event) => setBranding({ ...branding, supportPhone: event.target.value })} disabled={!canEdit} />
              </Field>
            </div>
            {canEdit && <button className="primary" disabled={busy}>Save branding</button>}
          </form>
        </Card>

        <Card title="Server status">
          {health ? (
            <div className="stack">
              <div className="kv"><span>API</span><strong>{health.status}</strong></div>
              <div className="kv"><span>Database</span><strong>{health.database}</strong></div>
              <div className="kv"><span>Version</span><strong>{health.version}</strong></div>
              <div className="kv"><span>Uptime</span><strong>{Math.round(health.uptimeSeconds / 60)} minutes</strong></div>
              <div className="kv"><span>Live subscribers</span><strong>{health.subscribers}</strong></div>
            </div>
          ) : (
            <Spinner label="Checking server…" />
          )}
        </Card>
        <DiagnosticsCard />
      </div>

      {tracking && (
        <Card title="Tracking settings" action={<span className="muted">Applied to Android devices (adaptive intervals)</span>}>
          <form onSubmit={saveTracking} className="stack">
            <div className="grid three">
              <Field label="Moving interval (s)">
                <input type="number" min={1} value={tracking.movingIntervalSeconds} onChange={(event) => setTracking({ ...tracking, movingIntervalSeconds: Number(event.target.value) })} disabled={!canEdit} />
              </Field>
              <Field label="Walking interval (s)">
                <input type="number" min={1} value={tracking.walkingIntervalSeconds} onChange={(event) => setTracking({ ...tracking, walkingIntervalSeconds: Number(event.target.value) })} disabled={!canEdit} />
              </Field>
              <Field label="Stationary interval (s)">
                <input type="number" min={1} value={tracking.stationaryIntervalSeconds} onChange={(event) => setTracking({ ...tracking, stationaryIntervalSeconds: Number(event.target.value) })} disabled={!canEdit} />
              </Field>
              <Field label="Low battery interval (s)">
                <input type="number" min={1} value={tracking.lowBatteryIntervalSeconds} onChange={(event) => setTracking({ ...tracking, lowBatteryIntervalSeconds: Number(event.target.value) })} disabled={!canEdit} />
              </Field>
              <Field label="Stop timeout (s)" hint="Stationary time before a trip ends">
                <input type="number" min={30} value={tracking.stopTimeoutSeconds} onChange={(event) => setTracking({ ...tracking, stopTimeoutSeconds: Number(event.target.value) })} disabled={!canEdit} />
              </Field>
              <Field label="GPS accuracy threshold (m)">
                <input type="number" min={1} value={tracking.gpsAccuracyThresholdMeters} onChange={(event) => setTracking({ ...tracking, gpsAccuracyThresholdMeters: Number(event.target.value) })} disabled={!canEdit} />
              </Field>
              <Field label="Stop cluster radius (m)" hint="Nearby still-points merge into one stop">
                <input type="number" min={10} max={1000} value={tracking.stopClusterRadiusMeters} onChange={(event) => setTracking({ ...tracking, stopClusterRadiusMeters: Number(event.target.value) })} disabled={!canEdit} />
              </Field>
              <Field label="Low battery threshold (%)">
                <input type="number" min={1} max={100} value={tracking.lowBatteryThreshold} onChange={(event) => setTracking({ ...tracking, lowBatteryThreshold: Number(event.target.value) })} disabled={!canEdit} />
              </Field>
              <Field label="Automatic trip detection">
                <select value={tracking.automaticTripDetection ? 'on' : 'off'} onChange={(event) => setTracking({ ...tracking, automaticTripDetection: event.target.value === 'on' })} disabled={!canEdit}>
                  <option value="on">Enabled</option>
                  <option value="off">Disabled</option>
                </select>
              </Field>
            </div>
            {canEdit && <button className="primary" disabled={busy}>Save tracking settings</button>}
          </form>
        </Card>
      )}

      {retention && (
        <Card title="Data retention" action={<span className="muted">A daily job deletes data older than these windows</span>}>
          <form onSubmit={saveRetention} className="stack">
            <div className="grid three">
              <Field label="Raw GPS retention (days)">
                <input type="number" min={1} value={retention.rawLocationDays} onChange={(event) => setRetention({ ...retention, rawLocationDays: Number(event.target.value) })} disabled={!canEdit} />
              </Field>
              <Field label="Trip retention (days)">
                <input type="number" min={1} value={retention.tripDays} onChange={(event) => setRetention({ ...retention, tripDays: Number(event.target.value) })} disabled={!canEdit} />
              </Field>
              <Field label="Audit log retention (days)">
                <input type="number" min={1} value={retention.auditLogDays} onChange={(event) => setRetention({ ...retention, auditLogDays: Number(event.target.value) })} disabled={!canEdit} />
              </Field>
            </div>
            {canEdit && <button className="primary" disabled={busy}>Save retention settings</button>}
          </form>
        </Card>
      )}

      <Card title="Your account">
        <form onSubmit={changePassword} className="stack">
          <div className="grid three">
            <Field label="Current password">
              <PasswordInput value={password.currentPassword} onChange={(event) => setPassword({ ...password, currentPassword: event.target.value })} required autoComplete="current-password" />
            </Field>
            <Field label="New password" hint="Minimum 12 characters">
              <PasswordInput value={password.newPassword} onChange={(event) => setPassword({ ...password, newPassword: event.target.value })} required minLength={12} autoComplete="new-password" />
            </Field>
            <Field label="Confirm new password">
              <PasswordInput value={password.confirmPassword} onChange={(event) => setPassword({ ...password, confirmPassword: event.target.value })} required minLength={12} autoComplete="new-password" />
            </Field>
          </div>
          <button className="primary" disabled={busy}>Change password</button>
        </form>
      </Card>
    </AppShell>
  );
}

function DiagnosticsCard() {
  const [, setTick] = useState(0);
  useEffect(() => onErrorsChange(() => setTick((tick) => tick + 1)), []);
  const errors = recentErrors();
  const theme = document.documentElement.dataset.theme ?? 'unknown';
  const report = [
    `build=${BUILD_INFO.buildId} built=${BUILD_INFO.buildTime}`,
    `route=${window.location.hash || '#/'} viewport=${window.innerWidth}x${window.innerHeight}`,
    `theme=${theme} ua=${window.navigator.userAgent}`,
    ...errors.map((entry) => `${entry.time} [${entry.kind}] ${entry.message}`),
  ].join('\n');

  return (
    <Card
      title="Diagnostics"
      action={
        <button
          className="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(report);
          }}
        >
          Copy report
        </button>
      }
    >
      <div className="stack">
        <div className="kv"><span>Bundle</span><strong>{BUILD_INFO.buildId} · {BUILD_INFO.buildTime === 'dev' ? 'dev' : new Date(BUILD_INFO.buildTime).toLocaleString()}</strong></div>
        <div className="kv"><span>Viewport</span><strong>{window.innerWidth}×{window.innerHeight}</strong></div>
        <div className="kv"><span>Theme</span><strong>{theme}</strong></div>
        {errors.length === 0 ? (
          <p className="muted">No client errors recorded in this session.</p>
        ) : (
          errors.map((entry, index) => (
            <div className="kv" key={`${entry.time}-${index}`}>
              <span>{entry.time} · {entry.kind}</span>
              <strong style={{ overflowWrap: 'anywhere' }}>{entry.message}</strong>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
