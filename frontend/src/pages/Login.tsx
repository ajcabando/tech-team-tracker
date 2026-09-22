import React, { useState } from 'react';
import { useAuth } from '../state/auth';
import { ErrorNote, PasswordInput } from '../components/ui';

export function LoginPage() {
  const { branding, login, setupRequired } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (thrown) {
      setError((thrown as { message?: string })?.message || 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-split">
      <section
        className="login-hero"
        style={branding.loginBackgroundUrl ? { backgroundImage: `linear-gradient(rgba(0,0,0,0.55), rgba(0,0,0,0.55)), url(${branding.loginBackgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
      >
        <div className="login-hero-content">
          {branding.logoUrl ? (
            <img className="login-hero-logo" src={branding.logoUrl} alt="" />
          ) : (
            <div className="login-hero-brand">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="3" />
                <line x1="12" y1="2" x2="12" y2="5" />
                <line x1="12" y1="19" x2="12" y2="22" />
                <line x1="2" y1="12" x2="5" y2="12" />
                <line x1="19" y1="12" x2="22" y2="12" />
              </svg>
            </div>
          )}
          <p className="login-hero-company">{branding.companyName}</p>
          <h1 className="login-hero-title">{branding.applicationName}</h1>
          <p className="login-hero-tagline">Secure live GPS tracking for field teams</p>

          <ul className="login-hero-features">
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" /><circle cx="12" cy="10" r="3" /></svg>
              <span>Real-time GPS visibility</span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
              <span>Automatic trip detection</span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              <span>Encrypted &amp; private</span>
            </li>
          </ul>
        </div>
        <div className="login-hero-footer">Self-hosted &middot; Open source</div>
      </section>

      <section className="login-form-panel">
        <form className="login-form" onSubmit={submit}>
          <div className="login-form-header">
            {branding.logoUrl && <img className="login-form-logo" src={branding.logoUrl} alt="" />}
            <h2>Welcome back</h2>
            <p className="muted">Sign in to your account</p>
          </div>

          <div className="login-field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoComplete="username"
            />
          </div>

          <div className="login-field">
            <label htmlFor="login-password">Password</label>
            <PasswordInput
              id="login-password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          <ErrorNote message={error} />

          <button className="login-submit" disabled={busy} type="submit">
            {busy ? (
              <span className="login-spinner" aria-label="Signing in">
                <span /><span /><span />
              </span>
            ) : (
              'Sign in'
            )}
          </button>

          {setupRequired && (
            <div className="login-setup-notice">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              <p>This installation has not been set up yet. Complete the first-run setup to create your superadmin account.</p>
            </div>
          )}

          <p className="login-footer-text">
            &copy; {new Date().getFullYear()} {branding.companyName}
          </p>
        </form>
      </section>
    </main>
  );
}
