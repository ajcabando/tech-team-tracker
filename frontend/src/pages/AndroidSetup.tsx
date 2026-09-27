import React from 'react';
import { AppShell, Card } from '../components/ui';
import { PhoneMockup, type MockScreen } from '../components/PhoneMockup';
import { Link } from '../lib/router';
import { useReleaseVersion } from '../lib/api';

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
  const release = useReleaseVersion();

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
          <a className="primary as-button" href="/tracker.apk" download="tracker.apk">
            Download APK{release ? ` · ${release} signed` : ''}
          </a>
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
            <PhoneMockup screen={step.mock} label={step.caption} version={release} />
          </Card>
        ))}
      </div>

      <Card title="Keep tracking reliable after the first day">
        <p className="muted">
          A paired phone restarts tracking by itself after a reboot, and it keeps running with the screen
          off. What it cannot do is survive the phone manufacturer deciding to stop it. Android's own
          battery saver will not kill a foreground location service, but several manufacturers add
          their own layers on top, and a tracker that goes quiet after three or four days is almost
          always one of them rather than a fault in the app.
        </p>
        <p className="muted">
          None of this can be done for you — the phone's owner has to approve it — and none of it is
          required for tracking to work. It only decides whether tracking is still working next month.
          The server raises a device-offline alert when a phone stops reporting, so you do not have to
          watch the dashboard to notice.
        </p>
        <ul className="bullets">
          <li>
            <strong>Every phone.</strong> In the app, choose <em>Open settings</em> on the battery
            prompt, then allow the app to run without battery restrictions. Also check
            Settings → Apps → Tracker → Battery and choose <em>Unrestricted</em> if the option exists.
          </li>
          <li>
            <strong>Samsung (One UI).</strong> Settings → Battery → <em>Background usage limits</em> →
            Never sleeping apps, and confirm the app is not in <em>Deep sleeping apps</em>. Also turn
            off <em>Remove apps that are rarely used</em> under Device care.
          </li>
          <li>
            <strong>Xiaomi / Redmi / Poco (MIUI, HyperOS).</strong> This is the most common cause of a
            tracker that never starts. Settings → Apps → Manage apps → Tracker →{' '}
            <em>Autostart</em> on, and set Battery saver to <em>No restrictions</em>. Without autostart
            the phone may not even deliver the reboot broadcast, so tracking never resumes at all.
          </li>
          <li>
            <strong>Huawei / Honor (EMUI, HarmonyOS).</strong> Settings → Apps → App launch → Tracker,
            then enable <em>Auto-launch</em>, <em>Secondary launch</em> and <em>Run in background</em>.
          </li>
          <li>
            <strong>OnePlus / Oppo / Realme.</strong> Settings → Battery → Battery optimisation, and
            allow the app. Also enable Recent-apps lock so a swipe-away does not stop it.
          </li>
          <li>
            <strong>Stock Android and Pixel.</strong> The app's own battery prompt is sufficient; no
            manufacturer settings are involved.
          </li>
        </ul>
      </Card>

      <Card title="Before handing over the phone">
        <ul className="bullets">
          <li>Confirm the server URL connects and pairing reports success.</li>
          <li>Start tracking and verify the permanent notification remains visible.</li>
          <li>Check Devices for an online status, recent timestamp, battery level, and GPS accuracy.</li>
          <li>Apply the battery exemption above, plus the manufacturer setting for that phone's brand.</li>
          <li>Never share dashboard credentials with the technician; the paired app uses its own restricted device token.</li>
        </ul>
      </Card>
    </AppShell>
  );
}
