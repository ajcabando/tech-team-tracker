import React from 'react';
import { AppShell, Card } from '../components/ui';
import { useAuth } from '../state/auth';
import { Link } from '../lib/router';

export function AboutPage() {
  const { branding, user } = useAuth();
  return (
    <AppShell title="About" subtitle="PRODUCT">
      <Card title={branding.applicationName}>
        <p className="muted">
          {branding.companyName} runs this self-hosted, open-source multi-technician GPS tracking platform. It combines a native Android foreground tracking
          service, a TypeScript API, PostgreSQL, and this responsive operations dashboard.
        </p>
        <div className="kv"><span>Organization</span><strong>{user?.organization?.name ?? branding.companyName}</strong></div>
        <div className="kv"><span>Signed in as</span><strong>{user?.email}</strong></div>
        <div className="kv"><span>Role</span><strong>{user?.role}</strong></div>
        <div className="kv"><span>Timezone</span><strong>{branding.timezone ?? 'UTC'}</strong></div>
        {branding.supportEmail && <div className="kv"><span>Support</span><strong>{branding.supportEmail}</strong></div>}
        {branding.supportPhone && <div className="kv"><span>Support phone</span><strong>{branding.supportPhone}</strong></div>}
      </Card>
      <Card title="Privacy and transparency">
        <ul className="bullets">
          <li>Tracking is authorized company tracking of company devices during work hours.</li>
          <li>The Android app shows a permanent, visible notification whenever tracking is active. There is no stealth mode.</li>
          <li>Raw GPS points are preserved for auditing; map-matched routes are optional and derived.</li>
          <li>Organizations can configure work schedules and data-retention windows from Settings.</li>
          <li>Passwords and tokens are never written to audit logs.</li>
        </ul>
      </Card>
      <Card title="Android tracking app" action={<Link to="/android-setup" className="link">Open setup guide →</Link>}>
        <p className="muted">Administrator instructions for privately installing, configuring, and pairing the Android tracking app.</p>
        <div className="kv"><span>Latest release</span><strong>v0.3.2 · signed</strong></div>
        <div className="row-actions" style={{ marginTop: 12 }}>
          <a className="primary as-button" href="/tracker.apk" download="tracker.apk">Download APK</a>
          <Link to="/android-setup" className="outline as-button">Setup guide</Link>
        </div>
        <p className="muted" style={{ marginTop: 10 }}>Admin-only distribution — do not upload it to a public file host. On the phone, allow installs from the browser used to open the file, install it, then turn that permission off again.</p>
      </Card>
      <Card title="API documentation">
        <p className="muted">
          Machine-readable API documentation is available at <code>/api/openapi.json</code>, with an interactive explorer at <code>/api/docs</code>.
        </p>
      </Card>
    </AppShell>
  );
}
