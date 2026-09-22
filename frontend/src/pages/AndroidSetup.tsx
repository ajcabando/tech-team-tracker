import React from 'react';
import { AppShell, Card } from '../components/ui';
import { PhoneMockup, type MockScreen } from '../components/PhoneMockup';
import { Link } from '../lib/router';

const steps: { title: string; body: string; mock: MockScreen; caption: string }[] = [
  {
    title: '1. Install the private APK',
    body: 'Download the signed APK using the button above (also available on the About page). Do not upload it to a public file host. On the phone, allow installs from the app used to open the APK, install it, then turn that permission off again.',
    mock: 'install',
    caption: 'APK download and Android install confirmation',
  },
  {
    title: '2. Connect to this server',
    body: 'Open the tracking app and enter the server address shown below. The phone must be able to reach this address over HTTPS or your trusted private network.',
    mock: 'pairing',
    caption: 'Server address field in the Android app',
  },
  {
    title: '3. Pair the technician',
    body: 'In this dashboard, open Technicians, choose Pair device, and generate a single-use code. Enter it in the Android app within 15 minutes. Pairing assigns that phone to the selected technician. Save the device admin password shown once — it unlocks the phone settings.',
    mock: 'status',
    caption: 'Pairing code field and successful pairing screen',
  },
  {
    title: '4. Grant required permissions',
    body: 'Allow precise location, background location (Allow all the time), and notifications when Android asks. Disable battery optimization for the tracking app so scheduled uploads continue reliably. Keep the permanent tracking notification enabled; it makes active tracking visible to the technician.',
    mock: 'permissions',
    caption: 'Location, notification, and battery permission screens',
  },
];

export function AndroidSetupPage() {
  const serverUrl = window.location.origin;

  return (
    <AppShell
      title="Android setup"
      subtitle="ADMIN GUIDE"
      actions={<Link to="/devices" className="outline as-button">Back to devices</Link>}
    >
      <Card className="setup-intro">
        <h2>Prepare a company phone for transparent tracking</h2>
        <p className="muted">This guide is for administrators. Give technicians the phone and privacy notice before tracking begins; the Android app always displays a foreground-service notification while tracking is active. Tracking starts automatically after pairing and only an administrator can stop it — there is no stop button on the phone.</p>
        <div className="server-address">
          <span>Server URL</span>
          <code>{serverUrl}</code>
        </div>
        <div className="row-actions" style={{ marginTop: 12 }}>
          <a className="primary as-button" href="/tracker.apk" download="tracker.apk">Download APK · v0.3.3 signed</a>
          <Link to="/about" className="outline as-button">About this release</Link>
        </div>
      </Card>

      <div className="setup-steps">
        {steps.map((step) => (
          <Card key={step.title} className="setup-step">
            <div>
              <h2>{step.title}</h2>
              <p className="muted">{step.body}</p>
            </div>
            <PhoneMockup screen={step.mock} label={step.caption} />
          </Card>
        ))}
      </div>

      <Card title="Before handing over the phone">
        <ul className="bullets">
          <li>Confirm the server URL connects and pairing reports success.</li>
          <li>Start tracking and verify the permanent notification remains visible.</li>
          <li>Check Devices for an online status, recent timestamp, battery level, and GPS accuracy.</li>
          <li>Never share dashboard credentials with the technician; the paired app uses its own restricted device token.</li>
        </ul>
      </Card>
    </AppShell>
  );
}
