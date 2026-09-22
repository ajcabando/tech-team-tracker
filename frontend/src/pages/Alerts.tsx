import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AppShell, Badge, Card, EmptyState, ErrorNote, Spinner } from '../components/ui';
import { relativeTime } from '../lib/format';

type Alert = {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  acknowledgedAt: string | null;
  createdAt: string;
  technician: { id: string; name: string } | null;
  device: { id: string; deviceName: string } | null;
};

const TONE = { INFO: 'primary', WARNING: 'warn', CRITICAL: 'bad' } as const;

export function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const query = unreadOnly ? '?acknowledged=false&limit=100' : '?limit=100';
      setAlerts(await api<Alert[]>(`/api/alerts${query}`));
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadOnly]);

  async function acknowledge(alert: Alert) {
    try {
      await api(`/api/alerts/${alert.id}/acknowledge`, { method: 'POST' });
      await load();
    } catch (thrown) {
      setError((thrown as { message?: string })?.message ?? 'Failed to acknowledge alert');
    }
  }

  return (
    <AppShell
      title="Alerts"
      subtitle="MONITORING"
      actions={
        <button className={unreadOnly ? 'chip active' : 'chip'} onClick={() => setUnreadOnly(!unreadOnly)}>
          {unreadOnly ? 'Showing unacknowledged' : 'Show unacknowledged only'}
        </button>
      }
    >
      <ErrorNote message={error} />
      <Card title={`${alerts.length} alert${alerts.length === 1 ? '' : 's'}`} action={<button className="link" onClick={() => void load()}>Refresh</button>}>
        {loading && <Spinner />}
        {!loading && alerts.length === 0 && <EmptyState title="No alerts" detail="Low battery, offline devices, and tracking issues appear here automatically." />}
        {alerts.map((alert) => (
          <div className="tech-row" key={alert.id}>
            <Badge tone={TONE[alert.severity]}>{alert.type.replace(/_/g, ' ')}</Badge>
            <div className="tech-info">
              <strong>{alert.message}</strong>
              <small>
                {alert.technician?.name ?? 'Unknown technician'}
                {alert.device ? ` · ${alert.device.deviceName}` : ''} · {relativeTime(alert.createdAt)}
              </small>
            </div>
            <div className="row-actions">
              {alert.acknowledgedAt ? <small className="muted">Acknowledged</small> : <button className="outline" onClick={() => void acknowledge(alert)}>Acknowledge</button>}
            </div>
          </div>
        ))}
      </Card>
    </AppShell>
  );
}
