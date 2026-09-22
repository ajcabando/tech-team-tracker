import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AppShell, Badge, Card, EmptyState, ErrorNote, Field, Modal, PasswordInput, RemoveDialog, Spinner } from '../components/ui';
import { useAuth } from '../state/auth';
import { shortDateTime } from '../lib/format';

type Organization = {
  id: string;
  name: string;
  slug: string;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  _count?: { technicians: number; devices: number; users: number; trips: number };
};

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: 'ACTIVE' | 'DISABLED';
  organizationId: string | null;
  lastLogin: string | null;
};

type AuditEntry = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  result: string;
  ipAddress: string | null;
  createdAt: string;
  user: { name: string; email: string } | null;
};

const TABS = ['Organizations', 'Users', 'Audit log'] as const;
const ROLES = ['ADMIN', 'MANAGER', 'DISPATCHER'] as const;

export function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Organizations');
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showOrg, setShowOrg] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const [removingOrg, setRemovingOrg] = useState<Organization | null>(null);
  const [removingUser, setRemovingUser] = useState<User | null>(null);
  const [resettingUser, setResettingUser] = useState<User | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [orgs, userList, logs] = await Promise.all([
        api<Organization[]>('/api/organizations').catch(() => [] as Organization[]),
        api<User[]>('/api/users').catch(() => [] as User[]),
        api<AuditEntry[]>('/api/audit-logs?limit=100').catch(() => [] as AuditEntry[]),
      ]);
      setOrganizations(orgs);
      setUsers(userList);
      setAudit(logs);
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Failed to load administration data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function setOrgStatus(organization: Organization, status: 'ACTIVE' | 'DISABLED') {
    await api(`/api/organizations/${organization.id}`, { method: 'PATCH', body: { status } });
    await load();
  }

  async function setUserStatus(target: User, status: 'ACTIVE' | 'DISABLED') {
    await api(`/api/users/${target.id}/status`, { method: 'PATCH', body: { status } });
    await load();
  }

  if (user?.role !== 'SUPERADMIN') {
    return (
      <AppShell title="System administration">
        <EmptyState title="Superadmin access required" />
      </AppShell>
    );
  }

  return (
    <AppShell
      title="System administration"
      subtitle="SUPERADMIN"
      actions={
        <div className="row-actions">
          {tab === 'Organizations' && <button className="primary" onClick={() => setShowOrg(true)}>New organization</button>}
          {tab === 'Users' && <button className="primary" onClick={() => setShowUser(true)}>New user</button>}
          <button className="outline" onClick={() => void load()}>Refresh</button>
        </div>
      }
    >
      <div className="tabs">
        {TABS.map((entry) => (
          <button key={entry} className={tab === entry ? 'tab active' : 'tab'} onClick={() => setTab(entry)}>
            {entry}
          </button>
        ))}
      </div>

      <ErrorNote message={error} />
      {loading && <Spinner />}

      {!loading && tab === 'Organizations' && (
        <Card title={`${organizations.length} organizations`}>
          {organizations.length === 0 && <EmptyState title="No organizations yet" />}
          <div className="table-wrap">
            {organizations.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Slug</th>
                    <th>Status</th>
                    <th>Technicians</th>
                    <th>Devices</th>
                    <th>Users</th>
                    <th>Trips</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {organizations.map((organization) => (
                    <tr key={organization.id}>
                      <td><strong>{organization.name}</strong><small>{shortDateTime(organization.createdAt)}</small></td>
                      <td>{organization.slug}</td>
                      <td><Badge tone={organization.status === 'ACTIVE' ? 'good' : 'bad'}>{organization.status}</Badge></td>
                      <td>{organization._count?.technicians ?? 0}</td>
                      <td>{organization._count?.devices ?? 0}</td>
                      <td>{organization._count?.users ?? 0}</td>
                      <td>{organization._count?.trips ?? 0}</td>
                      <td className="row-actions">
                        <button className="link" onClick={() => void setOrgStatus(organization, organization.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}>
                          {organization.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </button>
                        {organization.id === user?.organizationId ? (
                          <span className="muted" title="You cannot remove the organization you are signed in to">
                            Your organization
                          </span>
                        ) : (
                          <button className="link danger" onClick={() => setRemovingOrg(organization)}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {!loading && tab === 'Users' && (
        <Card title={`${users.length} users`}>
          {users.length === 0 && <EmptyState title="No users" />}
          <div className="table-wrap">
            {users.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Last login</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((entry) => (
                    <tr key={entry.id}>
                      <td><strong>{entry.name}</strong></td>
                      <td>{entry.email}</td>
                      <td><Badge tone="primary">{entry.role}</Badge></td>
                      <td><Badge tone={entry.status === 'ACTIVE' ? 'good' : 'bad'}>{entry.status}</Badge></td>
                      <td>{entry.lastLogin ? shortDateTime(entry.lastLogin) : 'Never'}</td>
                      <td className="row-actions">
                        <button className="link" onClick={() => setResettingUser(entry)} title="Set a new password for this user">
                          Password
                        </button>
                        <button className="link" onClick={() => void setUserStatus(entry, entry.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}>
                          {entry.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                        </button>
                        {entry.id === user?.id ? (
                          <span className="muted" title="You cannot remove your own account">
                            You
                          </span>
                        ) : (
                          <button className="link danger" onClick={() => setRemovingUser(entry)}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {!loading && tab === 'Audit log' && (
        <Card title={`${audit.length} recent entries`}>
          {audit.length === 0 && <EmptyState title="No audit entries yet" />}
          <div className="table-wrap">
            {audit.length > 0 && (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Resource</th>
                    <th>Result</th>
                    <th>IP</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((entry) => (
                    <tr key={entry.id}>
                      <td>{shortDateTime(entry.createdAt)}</td>
                      <td>{entry.user?.email ?? 'system'}</td>
                      <td><code>{entry.action}</code></td>
                      <td>{entry.resource}{entry.resourceId ? ` · ${entry.resourceId.slice(0, 8)}` : ''}</td>
                      <td><Badge tone={entry.result === 'SUCCESS' ? 'good' : 'bad'}>{entry.result}</Badge></td>
                      <td>{entry.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {showOrg && (
        <Modal title="New organization" onClose={() => setShowOrg(false)}>
          <CreateOrgForm
            onDone={() => {
              setShowOrg(false);
              void load();
            }}
          />
        </Modal>
      )}

      {showUser && (
        <Modal title="New user" onClose={() => setShowUser(false)}>
          <CreateUserForm
            organizations={organizations}
            onDone={() => {
              setShowUser(false);
              void load();
            }}
          />
        </Modal>
      )}

      {removingUser && (
        <RemoveDialog
          title="Remove account"
          subject={`${removingUser.name} · ${removingUser.email}`}
          consequence="The account is erased and every session it holds is signed out immediately. The audit trail is kept — entries this account authored stay in place — so disable it instead when access should stop but the record must remain."
          remove={async () => {
            await api(`/api/users/${removingUser.id}`, { method: 'DELETE' });
          }}
          onClose={() => setRemovingUser(null)}
          onRemoved={() => {
            setRemovingUser(null);
            void load();
          }}
        />
      )}

      {removingOrg && (
        <RemoveDialog
          title="Remove organization"
          subject={`${removingOrg.name} · ${removingOrg.slug}`}
          consequence="The organization and everything inside it disappear from the system: technicians, devices, GPS history, trips, alerts, and branded settings. Disable it instead to keep the record without allowing sign-in."
          historyTitle="This organization still contains data"
          purgeLabel="Erase everything and remove"
          remove={async (purge) => {
            await api(`/api/organizations/${removingOrg.id}${purge ? '?purge=true' : ''}`, { method: 'DELETE' });
          }}
          onClose={() => setRemovingOrg(null)}
          onRemoved={() => {
            setRemovingOrg(null);
            void load();
          }}
        />
      )}

      {resettingUser && (
        <Modal title={`Reset password · ${resettingUser.email}`} onClose={() => setResettingUser(null)}>
          <ResetPasswordForm
            user={resettingUser}
            onDone={() => {
              setResettingUser(null);
              void load();
            }}
          />
        </Modal>
      )}
    </AppShell>
  );
}

function CreateOrgForm({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: '', slug: '', applicationName: '', timezone: 'UTC' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/organizations', { method: 'POST', body: { ...form, slug: form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } });
      onDone();
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Could not create organization');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <Field label="Organization name">
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
      </Field>
      <Field label="Slug" hint="Lowercase letters, numbers, and dashes">
        <input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="acme-connect" />
      </Field>
      <Field label="Application name">
        <input value={form.applicationName} onChange={(event) => setForm({ ...form, applicationName: event.target.value })} placeholder="ACME TRACKER" />
      </Field>
      <Field label="Timezone">
        <input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
      </Field>
      <ErrorNote message={error} />
      <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create organization'}</button>
    </form>
  );
}

function ResetPasswordForm({ user, onDone }: { user: User; onDone: () => void }) {
  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (form.newPassword !== form.confirmPassword) return setError('New passwords do not match');
    setBusy(true);
    setError('');
    try {
      await api(`/api/users/${user.id}/password`, { method: 'POST', body: form });
      onDone();
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Could not reset password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <p className="muted">
        Set a new password for <strong>{user.name}</strong> ({user.email}). Their sessions are signed out immediately — share the new password with them directly.
      </p>
      <Field label="New password" hint="Minimum 12 characters">
        <PasswordInput value={form.newPassword} onChange={(event) => setForm({ ...form, newPassword: event.target.value })} required minLength={12} autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password">
        <PasswordInput value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} required minLength={12} autoComplete="new-password" />
      </Field>
      <ErrorNote message={error} />
      <button className="primary" disabled={busy}>{busy ? 'Resetting…' : 'Reset password'}</button>
    </form>
  );
}

function CreateUserForm({ organizations, onDone }: { organizations: Organization[]; onDone: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'DISPATCHER' as string, organizationId: organizations[0]?.id ?? '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/users', { method: 'POST', body: { ...form, organizationId: form.organizationId || undefined } });
      onDone();
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Could not create user');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="stack">
      <Field label="Name">
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
      </Field>
      <Field label="Email">
        <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
      </Field>
      <Field label="Temporary password" hint="Minimum 12 characters">
        <PasswordInput value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required minLength={12} autoComplete="new-password" />
      </Field>
      <Field label="Role">
        <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
          <option value="SUPERADMIN">SUPERADMIN</option>
          <option value="ADMIN">ADMIN</option>
          {ROLES.filter((role) => role !== 'ADMIN').map((role) => (
            <option key={role} value={role}>{role}</option>
          ))}
        </select>
      </Field>
      <Field label="Organization">
        <select value={form.organizationId} onChange={(event) => setForm({ ...form, organizationId: event.target.value })}>
          <option value="">— none —</option>
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>{organization.name}</option>
          ))}
        </select>
      </Field>
      <ErrorNote message={error} />
      <button className="primary" disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button>
    </form>
  );
}
