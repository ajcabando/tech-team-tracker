import React, { useEffect, useRef, useState } from 'react';
import { Link, useRouter } from '../lib/router';
import { useAuth } from '../state/auth';
import { useTheme, ThemeMode } from '../state/theme';
import { initials } from '../lib/format';
import { api, ApiError } from '../lib/api';

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="center-state">
      <div className="spinner" />
      <p className="muted">{label}</p>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return <p className="error-note">{message}</p>;
}

export function EmptyState({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {detail && <p className="muted">{detail}</p>}
    </div>
  );
}

export function Card({ title, action, children, className = '' }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: 'primary' | 'good' | 'warn' | 'bad' }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}

export function Badge({ tone = 'muted', children }: { tone?: 'good' | 'warn' | 'bad' | 'muted' | 'primary'; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Avatar({ name }: { name: string }) {
  return <span className="avatar">{initials(name)}</span>;
}

export function KpiCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <section className={`kpi${tone ? ` kpi-${tone}` : ''}`} aria-label={label}>
      <span className="kpi-icon" aria-hidden="true">
        {icon}
      </span>
      <small>{label}</small>
      <strong>{value}</strong>
      {sub != null && <span>{sub}</span>}
    </section>
  );
}

export function Skeleton({ height = 14 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} aria-hidden="true" />;
}

export function SkeletonCard({ lines = 4 }: { lines?: number }) {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <Skeleton height={18} />
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} />
      ))}
    </div>
  );
}

export type RemovalHistory = {
  locations?: number;
  trips?: number;
  alerts?: number;
  devices?: number;
  technicians?: number;
  users?: number;
};

/**
 * Two-step removal confirmation.
 *
 * The first attempt calls the API without purging. If the server refuses because the
 * record has GPS history, the dialog explains exactly what would be erased and requires a
 * second, explicit confirmation — history is never deleted silently.
 */
export function RemoveDialog({
  title,
  subject,
  consequence,
  historyTitle = 'This record has GPS history',
  purgeLabel = 'Erase history and remove',
  remove,
  onClose,
  onRemoved,
}: {
  title: string;
  subject: string;
  consequence: string;
  /** Heading shown above the affected records once the server reports them. */
  historyTitle?: string;
  /** Label for the second, destructive confirmation button. */
  purgeLabel?: string;
  remove: (purge: boolean) => Promise<void>;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<RemovalHistory | null>(null);

  const run = async (purge: boolean) => {
    setBusy(true);
    setError('');
    try {
      await remove(purge);
      onRemoved();
    } catch (thrown) {
      const apiError = thrown as ApiError;
      const reported = apiError.payload?.history as RemovalHistory | undefined;
      if (apiError.status === 409 && reported) setHistory(reported);
      else setError(apiError.message ?? 'Removal failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <p className="muted">{consequence}</p>
        <div className="remove-subject">{subject}</div>

        {history && (
          <div className="danger-panel">
            <strong>{historyTitle}</strong>
            <ul className="bullets">
              <li>{history.locations ?? 0} raw GPS point{(history.locations ?? 0) === 1 ? '' : 's'}</li>
              <li>{history.trips ?? 0} trip{(history.trips ?? 0) === 1 ? '' : 's'}</li>
              {(history.alerts ?? 0) > 0 && <li>{history.alerts} alert{(history.alerts ?? 0) === 1 ? '' : 's'}</li>}
              {(history.devices ?? 0) > 0 && <li>{history.devices} device{(history.devices ?? 0) === 1 ? '' : 's'}</li>}
              {(history.technicians ?? 0) > 0 && <li>{history.technicians} technician{(history.technicians ?? 0) === 1 ? '' : 's'}</li>}
              {(history.users ?? 0) > 0 && <li>{history.users} user account{(history.users ?? 0) === 1 ? '' : 's'}</li>}
            </ul>
            <p className="muted">
              Erasing deletes these records permanently and cannot be undone. Take a backup first if you may need them.
            </p>
          </div>
        )}

        <ErrorNote message={error} />

        <div className="row-actions">
          <button className="outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {history ? (
            <button className="primary danger-solid" onClick={() => void run(true)} disabled={busy}>
              {busy ? 'Erasing…' : purgeLabel}
            </button>
          ) : (
            <button className="primary danger-solid" onClick={() => void run(false)} disabled={busy}>
              {busy ? 'Removing…' : 'Remove'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

const EYE_OPEN = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EYE_CLOSED = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M17.94 17.94A10.6 10.6 0 0 1 12 19c-6.5 0-10-7-10-7a17.6 17.6 0 0 1 4.06-4.94" />
    <path d="M9.9 4.24A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17.7 17.7 0 0 1-2.16 3.19" />
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="m2 2 20 20" />
  </svg>
);

/** Password input with a show/hide ("eye") toggle. Masked by default. */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="password-wrap">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="password-peek"
        onClick={() => setVisible((current) => !current)}
        onMouseDown={(event) => event.preventDefault()}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? EYE_CLOSED : EYE_OPEN}
      </button>
    </span>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <header className="card-head">
          <h2>{title}</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

const SIDEBAR_KEY = 'tracker.sidebar';

/** Segment -> human label for breadcrumbs (route ids fall back to "Detail"). */
const BREADCRUMB_LABELS: Record<string, string> = {
  technicians: 'Technicians',
  devices: 'Devices',
  trips: 'Trips',
  reports: 'Reports',
  alerts: 'Alerts',
  settings: 'Settings',
  superadmin: 'System admin',
  about: 'About',
  'android-setup': 'Android setup',
};

const NAV_ICONS: Record<string, React.ReactNode> = {
  dashboard: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
  ),
  technicians: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><circle cx="17" cy="9" r="2.6" /><path d="M15.6 14.6c2.3.2 4 1.6 4.5 4" /></svg>
  ),
  devices: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>
  ),
  trips: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13l-3-3" /><path d="M20 16H7l3 3" /></svg>
  ),
  reports: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-8" /><path d="M21 20H3" /></svg>
  ),
  alerts: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8" /></svg>
  ),
  admin: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 2.8v5.4c0 4.6-3 7.8-7 9.8-4-2-7-5.2-7-9.8V5.8z" /><path d="M9.5 12l2 2 3.5-4" /></svg>
  ),
  about: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5" /><path d="M12 7.6v.4" /></svg>
  ),
  logout: (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8" /><path d="M6.3 6.5a8 8 0 1 0 11.4 0" /></svg>
  ),
};

const NAV: Array<{ to: string; label: string; icon: keyof typeof NAV_ICONS; roles?: string[] }> = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/technicians', label: 'Technicians', icon: 'technicians' },
  { to: '/devices', label: 'Devices', icon: 'devices' },
  { to: '/trips', label: 'Trips', icon: 'trips' },
  { to: '/reports', label: 'Reports', icon: 'reports' },
  { to: '/alerts', label: 'Alerts', icon: 'alerts' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
  { to: '/superadmin', label: 'System admin', icon: 'admin', roles: ['SUPERADMIN'] },
  { to: '/about', label: 'About', icon: 'about' },
];

function isActive(navTo: string, path: string): boolean {
  if (navTo === '/') return path === '/' || path === '';
  return path.startsWith(navTo);
}

const THEME_ORDER: ThemeMode[] = ['light', 'dark', 'system'];
const THEME_META: Record<ThemeMode, { label: string; icon: React.ReactNode }> = {
  light: {
    label: 'Light',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3L19 19M19 5l-1.7 1.7M6.7 17.3L5 19" /></svg>
    ),
  },
  dark: {
    label: 'Dark',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" /></svg>
    ),
  },
  system: {
    label: 'System',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M9 20.5h6" /></svg>
    ),
  },
};

function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(mode) + 1) % THEME_ORDER.length];
  return (
    <button
      className="icon-btn"
      onClick={() => setMode(next)}
      title={`Theme: ${mode} (switch to ${next})`}
      aria-label={`Theme: ${mode}. Activate to switch to ${next} theme.`}
    >
      {THEME_META[mode].icon}
    </button>
  );
}

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  const date = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${date} · ${time}`;
}

export function AppShell({ children, title, subtitle, actions }: { children: React.ReactNode; title: string; subtitle?: string; actions?: React.ReactNode }) {
  const { user, branding, logout } = useAuth();
  const { path, segments, navigate } = useRouter();
  // Surfaced in the footer so operators can confirm which build is actually loaded.
  const [version, setVersion] = useState('');
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored) return stored === 'collapsed';
    return window.innerWidth < 1200;
  });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [unread, setUnread] = useState(0);
  const clock = useClock();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    api<{ version: string }>('/health/version', { auth: false })
      .then((result) => setVersion(result.version))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let active = true;
    api<Array<{ id: string }>>('/api/alerts?acknowledged=false&limit=100')
      .then((alerts) => active && setUnread(alerts.length))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [path]);

  useEffect(() => setDrawerOpen(false), [path]);

  useEffect(() => {
    if (!drawerOpen) return;
    drawerCloseRef.current?.focus();
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
      }
      if (event.key === 'Tab') {
        const focusable = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [drawerOpen]);

  // A narrow sidebar is practical on tablets, so remember the operator's preference.
  const toggleSidebar = () => {
    setCollapsed((current) => {
      localStorage.setItem(SIDEBAR_KEY, current ? 'expanded' : 'collapsed');
      return !current;
    });
  };

  const nav = NAV.filter((item) => !item.roles || (user && item.roles.includes(user.role)));
  const crumbs = segments.reduce<Array<{ label: string; to: string }>>(
    (accumulator, segment, index) => {
      const to = `/${segments.slice(0, index + 1).join('/')}`;
      accumulator.push({ label: BREADCRUMB_LABELS[segment] ?? 'Detail', to });
      return accumulator;
    },
    [{ label: 'Dashboard', to: '/' }],
  );

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const query = search.trim();
    if (query) navigate(`/technicians?search=${encodeURIComponent(query)}`);
  };

  return (
    <div
      className={`app${collapsed ? ' sidebar-collapsed' : ''}${drawerOpen ? ' drawer-open' : ''}`}
    >
      <header className="mobile-header">
        <div className="mobile-brand">
          {branding.logoUrl ? <img className="brandmark-img" src={branding.logoUrl} alt="" /> : <span className="brandmark">◎</span>}
          <div className="brand-text">
            <strong>{branding.applicationName}</strong>
            <small>{branding.companyName}</small>
          </div>
        </div>
        <Link to="/alerts" className="menu-toggle as-button" aria-label={unread > 0 ? `Alerts, ${unread} unacknowledged` : 'Alerts'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></svg>
        </Link>
        <ThemeToggle />
        <button ref={menuButtonRef} className="menu-toggle" onClick={() => setDrawerOpen(true)} aria-label="Open navigation" aria-controls="main-sidebar" aria-expanded={drawerOpen}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </header>
      <button className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-label="Close navigation" tabIndex={drawerOpen ? 0 : -1} />
      <aside ref={sidebarRef} className="sidebar" id="main-sidebar" aria-label="Primary navigation">
        <div className="brand">
          {branding.logoUrl ? <img className="brandmark-img" src={branding.logoUrl} alt="" /> : <span className="brandmark">◎</span>}
          <div className="brand-text">
            <strong>{branding.applicationName}</strong>
            <small>{branding.companyName}</small>
          </div>
          <button
            className="collapse-toggle"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          >
            {collapsed ? '»' : '«'}
          </button>
          <button ref={drawerCloseRef} className="drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close navigation">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <nav aria-label="Main">
          {nav.map((item) => (
            <Link key={item.to} to={item.to} className={isActive(item.to, path) ? 'active' : ''} title={item.label} onClick={() => setDrawerOpen(false)}>
              <span className="nav-icon" aria-hidden="true">
                {NAV_ICONS[item.icon]}
              </span>
              <span className="nav-label">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="account">
            <Avatar name={user?.name ?? 'User'} />
            <div className="account-text">
              <strong>{user?.name}</strong>
              <small>{user?.role}</small>
            </div>
          </div>
          <button className="outline signout" onClick={() => void logout()} title="Sign out">
            <span className="nav-icon" aria-hidden="true">
              {NAV_ICONS.logout}
            </span>
            <span className="nav-label">Sign out</span>
          </button>
          {version && <small className="build-tag">Build v{version}</small>}
        </div>
      </aside>
      <section className="content">
        <header className="topbar">
          <form className="topbar-search" onSubmit={submitSearch} role="search">
            <input
              type="search"
              placeholder="Search technicians, devices…"
              aria-label="Search technicians"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button className="outline" type="submit">
              Search
            </button>
          </form>
          <div className="topbar-right">
            <div className="topbar-clock" aria-label={`Current date and time: ${clock}`}>
              <strong>{clock}</strong>
            </div>
            <Link to="/alerts" className="icon-btn as-button" aria-label={unread > 0 ? `Alerts, ${unread} unacknowledged` : 'Alerts, none unacknowledged'} title="Alerts">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15z" /><path d="M10 21a2.2 2.2 0 0 0 4 0" /></svg>
              {unread > 0 && <span className="count-badge">{unread > 99 ? '99+' : unread}</span>}
            </Link>
            <ThemeToggle />
          </div>
        </header>
        <header className="page-head">
          <div>
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              {crumbs.map((crumb, index) =>
                index === crumbs.length - 1 ? (
                  <span key={crumb.to} className="crumb current" aria-current="page">
                    {crumb.label}
                  </span>
                ) : (
                  <React.Fragment key={crumb.to}>
                    <Link to={crumb.to} className="crumb">
                      {crumb.label}
                    </Link>
                    <span className="crumb-sep" aria-hidden="true">
                      /
                    </span>
                  </React.Fragment>
                ),
              )}
            </nav>
            {subtitle && <p className="eyebrow">{subtitle}</p>}
            <h1>{title}</h1>
          </div>
          <div className="page-actions">{actions}</div>
        </header>
        {children}
      </section>
    </div>
  );
}
