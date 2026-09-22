import React, { useState } from 'react';
import { api, setTokens } from '../lib/api';
import { useAuth } from '../state/auth';
import { ErrorNote, Field, PasswordInput } from '../components/ui';

export function SetupPage({ onDone }: { onDone: () => void }) {
  const { reloadBranding } = useAuth();
  const [form, setForm] = useState({
    companyName: '',
    applicationName: '',
    superadminName: '',
    superadminEmail: '',
    password: '',
    confirmPassword: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    country: '',
    primaryColor: '#0ea5e9',
    secondaryColor: '#0f172a',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: event.target.value });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (form.password !== form.confirmPassword) return setError('Passwords do not match');
    if (form.password.length < 12) return setError('Password must be at least 12 characters');
    setBusy(true);
    try {
      await api('/api/setup', {
        method: 'POST',
        auth: false,
        body: {
          ...form,
          applicationName: form.applicationName || `${form.companyName} TRACKER`,
        },
      });
      const login = await api<{ accessToken: string; refreshToken: string }>('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: { email: form.superadminEmail, password: form.password },
      });
      setTokens(login.accessToken, login.refreshToken);
      await reloadBranding();
      onDone();
    } catch (thrown) {
      setError((thrown as { message?: string })?.message || 'Setup failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-card wide" onSubmit={submit}>
        <p className="eyebrow">FIRST-RUN SETUP</p>
        <h1>Initialize your tracking platform</h1>
        <p className="muted">
          This runs once. It creates your organization, branding, and the first superadmin, then disables itself. Choose a strong password — there is no
          default account.
        </p>

        <div className="grid two">
          <Field label="Company name">
            <input value={form.companyName} onChange={update('companyName')} placeholder="ACME FIELD SERVICES" required />
          </Field>
          <Field label="Application name" hint="Shown across the dashboard and Android app">
            <input value={form.applicationName} onChange={update('applicationName')} placeholder="ACME TRACKER" />
          </Field>
          <Field label="Superadmin name">
            <input value={form.superadminName} onChange={update('superadminName')} required />
          </Field>
          <Field label="Superadmin email">
            <input type="email" value={form.superadminEmail} onChange={update('superadminEmail')} required />
          </Field>
          <Field label="Password" hint="Minimum 12 characters">
            <PasswordInput value={form.password} onChange={update('password')} required minLength={12} autoComplete="new-password" />
          </Field>
          <Field label="Confirm password">
            <PasswordInput value={form.confirmPassword} onChange={update('confirmPassword')} required minLength={12} autoComplete="new-password" />
          </Field>
          <Field label="Timezone">
            <input value={form.timezone} onChange={update('timezone')} />
          </Field>
          <Field label="Country code">
            <input value={form.country} onChange={update('country')} placeholder="PH" />
          </Field>
          <Field label="Primary color">
            <input type="color" value={form.primaryColor} onChange={update('primaryColor')} />
          </Field>
          <Field label="Secondary color">
            <input type="color" value={form.secondaryColor} onChange={update('secondaryColor')} />
          </Field>
        </div>

        <ErrorNote message={error} />
        <button className="primary" disabled={busy}>
          {busy ? 'Initializing…' : 'Initialize system'}
        </button>
      </form>
    </main>
  );
}
