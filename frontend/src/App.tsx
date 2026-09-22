import React from 'react';
import { useRouter } from './lib/router';
import { useAuth, useBrandTheme, DEFAULT_BRANDING } from './state/auth';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/Login';
import { SetupPage } from './pages/Setup';
import { DashboardPage } from './pages/Dashboard';
import { TechniciansPage } from './pages/Technicians';
import { TechnicianDetailPage } from './pages/TechnicianDetail';
import { DevicesPage } from './pages/Devices';
import { TripsPage } from './pages/Trips';
import { TripDetailPage } from './pages/TripDetail';
import { ReportsPage } from './pages/Reports';
import { AlertsPage } from './pages/Alerts';
import { SettingsPage } from './pages/Settings';
import { AdminPage } from './pages/Admin';
import { AboutPage } from './pages/About';
import { AndroidSetupPage } from './pages/AndroidSetup';
import { ErrorBoundary } from './components/ErrorBoundary';

function Routes() {
  const { segments } = useRouter();
  const [first, second] = segments;

  switch (first) {
    case undefined:
      return <DashboardPage />;
    case 'technicians':
      return second ? <TechnicianDetailPage id={second} /> : <TechniciansPage />;
    case 'devices':
      return <DevicesPage />;
    case 'trips':
      return second ? <TripDetailPage id={second} /> : <TripsPage />;
    case 'reports':
      return <ReportsPage />;
    case 'alerts':
      return <AlertsPage />;
    case 'settings':
      return <SettingsPage />;
    case 'superadmin':
      return <AdminPage />;
    case 'about':
      return <AboutPage />;
    case 'android-setup':
      return <AndroidSetupPage />;
    default:
      return <DashboardPage />;
  }
}

export function App() {
  const { ready, user, setupRequired, branding } = useAuth();
  useBrandTheme(branding ?? DEFAULT_BRANDING);

  if (!ready) {
    return (
      <main className="auth-screen">
        <Spinner label="Starting tracker…" />
      </main>
    );
  }
  if (setupRequired && !user) return <SetupPage onDone={() => window.location.reload()} />;
  if (!user) return <LoginPage />;
  return (
    <ErrorBoundary>
      <Routes />
    </ErrorBoundary>
  );
}
