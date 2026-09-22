import React from 'react';

export type MockScreen = 'install' | 'pairing' | 'status' | 'permissions';

function StatusBar({ dark }: { dark: boolean }) {
  return (
    <div className={`pm-statusbar${dark ? ' dark' : ''}`}>
      <span>9:41</span>
      <span className="pm-statusicons" aria-hidden="true">
        <i className="pm-signal" />
        <i className="pm-battery" />
      </span>
    </div>
  );
}

function InstallScreen() {
  return (
    <div className="pm-screen light">
      <StatusBar dark={false} />
      <div className="pm-install-head">
        <span className="pm-appicon">◎</span>
        <div>
          <strong>Tracker</strong>
          <small>v0.3.2 · 8.4 MB</small>
        </div>
      </div>
      <p className="pm-install-q">Do you want to install this application?</p>
      <p className="pm-install-sub">It will get access to:</p>
      <ul className="pm-perm-list">
        <li>Precise location</li>
        <li>Location all the time</li>
        <li>Notifications</li>
      </ul>
      <div className="pm-install-actions">
        <span>Cancel</span>
        <strong>Install</strong>
      </div>
      <div className="pm-homebar" aria-hidden="true" />
    </div>
  );
}

function PairingScreen() {
  return (
    <div className="pm-screen night">
      <StatusBar dark />
      <div className="pm-pair-body">
        <span className="pm-pin" aria-hidden="true">◎</span>
        <strong className="pm-appname">TECH TEAM TRACKER</strong>
        <small className="pm-tagline">Track. Support. Serve.</small>
        <div className="pm-field">
          <label>Server address</label>
          <span>https://tracker.example.com</span>
        </div>
        <div className="pm-field">
          <label>Pairing code</label>
          <span className="pm-code">7K4P-92MX</span>
        </div>
        <div className="pm-primary">Pair device</div>
      </div>
      <div className="pm-homebar light" aria-hidden="true" />
    </div>
  );
}

function StatusScreen() {
  return (
    <div className="pm-screen night">
      <StatusBar dark />
      <div className="pm-status-body">
        <small className="pm-appname-sm">TECH TEAM TRACKER</small>
        <span className="pm-conn">● Online</span>
        <span className="pm-pulse" aria-hidden="true" />
        <strong className="pm-bigstatus">Online</strong>
        <small className="pm-status-sub">Your location is being recorded.</small>
        <div className="pm-pills">
          <span>GPS ±8 m</span>
        </div>
        <small className="pm-updated">Last update just now</small>
        <span className="pm-gear" aria-hidden="true">⚙</span>
      </div>
      <div className="pm-homebar light" aria-hidden="true" />
    </div>
  );
}

function PermissionsScreen() {
  return (
    <div className="pm-screen light sheet">
      <StatusBar dark={false} />
      <div className="pm-sheet-body">
        <strong>Allow Tracker to access this device's location?</strong>
        <div className="pm-radio on">
          <i aria-hidden="true" />
          <div><span>While using the app</span></div>
        </div>
        <div className="pm-radio">
          <i aria-hidden="true" />
          <div><span>Only this time</span></div>
        </div>
        <div className="pm-radio">
          <i aria-hidden="true" />
          <div><span>Don't allow</span></div>
        </div>
        <div className="pm-toggle-row">
          <span>Use precise location</span>
          <i className="pm-switch on" aria-hidden="true" />
        </div>
        <small className="pm-sheet-note">To allow all the time, open Settings → Location → Allow all the time.</small>
      </div>
      <div className="pm-homebar" aria-hidden="true" />
    </div>
  );
}

/**
 * Realistic in-browser illustration of a phone screen from the setup flow.
 * Faithful to the real app's layout, strings and colors — replace with genuine
 * captures if they become available.
 */
export function PhoneMockup({ screen, label }: { screen: MockScreen; label: string }) {
  return (
    <figure className="phone-mockup" role="img" aria-label={`Illustration: ${label}`}>
      <div className="pm-frame">
        <div className="pm-notch" aria-hidden="true" />
        {screen === 'install' && <InstallScreen />}
        {screen === 'pairing' && <PairingScreen />}
        {screen === 'status' && <StatusScreen />}
        {screen === 'permissions' && <PermissionsScreen />}
      </div>
      <figcaption>Illustration</figcaption>
    </figure>
  );
}
