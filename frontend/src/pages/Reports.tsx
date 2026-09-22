import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AppShell, Card, EmptyState, ErrorNote, Field, Spinner, StatCard } from '../components/ui';
import { clock, dateInputValue, duration, kilometers, speed } from '../lib/format';

type ReportRow = {
  technicianId: string;
  name: string;
  employeeNumber: string;
  totalTrips: number;
  totalDistanceMeters: number;
  totalDrivingSeconds: number;
  maxSpeed: number;
  averageSpeed: number;
  totalStops: number;
  longestStopSeconds: number;
  firstActivity: string | null;
  lastActivity: string | null;
};

type Report = { from: string; to: string; totals: Omit<ReportRow, 'technicianId' | 'name' | 'employeeNumber'>; technicians: ReportRow[] };

const PERIODS = ['daily', 'weekly', 'monthly'] as const;

export function ReportsPage() {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('daily');
  const [date, setDate] = useState(dateInputValue());
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    api<Report>(`/api/reports/${period}?date=${date}`)
      .then((result) => active && setReport(result))
      .catch((thrown) => active && setError((thrown as { message?: string })?.message ?? 'Failed to build report'))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [period, date]);

  return (
    <AppShell
      title="Reports"
      subtitle="PERFORMANCE"
      actions={
        <div className="row-actions">
          {PERIODS.map((value) => (
            <button key={value} className={period === value ? 'chip active' : 'chip'} onClick={() => setPeriod(value)}>
              {value}
            </button>
          ))}
        </div>
      }
    >
      <Card title="Period">
        <Field label={`Reference date (${period})`}>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </Field>
        {report && (
          <p className="muted">
            {new Date(report.from).toLocaleString()} → {new Date(report.to).toLocaleString()}
          </p>
        )}
      </Card>

      <ErrorNote message={error} />
      {loading && <Spinner />}

      {report && (
        <>
          <div className="stats">
            <StatCard label="Total trips" value={report.totals.totalTrips} />
            <StatCard label="Total distance" value={kilometers(report.totals.totalDistanceMeters)} />
            <StatCard label="Driving time" value={duration(report.totals.totalDrivingSeconds)} />
            <StatCard label="Max speed" value={speed(report.totals.maxSpeed)} />
            <StatCard label="Average speed" value={speed(report.totals.averageSpeed)} />
            <StatCard label="Stops" value={report.totals.totalStops} hint={`Longest ${duration(report.totals.longestStopSeconds)}`} />
            <StatCard label="First activity" value={clock(report.totals.firstActivity)} />
            <StatCard label="Last activity" value={clock(report.totals.lastActivity)} />
          </div>

          <Card title="Distance by technician">
            {report.technicians.length === 0 && <EmptyState title="No activity in this period" />}
            {report.technicians
              .slice()
              .sort((a, b) => b.totalDistanceMeters - a.totalDistanceMeters)
              .map((row) => {
                const max = Math.max(...report.technicians.map((entry) => entry.totalDistanceMeters), 1);
                return (
                  <div className="bar-row" key={row.technicianId}>
                    <span>
                      <strong>{row.name}</strong>
                    </span>
                    <span className="bar-track" role="img" aria-label={`${row.name}: ${kilometers(row.totalDistanceMeters)}`}>
                      <span className="bar-fill" style={{ width: `${Math.max(2, (row.totalDistanceMeters / max) * 100)}%` }} />
                    </span>
                    <small>{kilometers(row.totalDistanceMeters)}</small>
                  </div>
                );
              })}
          </Card>

          <Card title="Per technician" className="cards-mobile">
            {report.technicians.length === 0 && <EmptyState title="No activity in this period" />}
            {report.technicians.length > 0 && (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Technician</th>
                      <th>Trips</th>
                      <th>Distance</th>
                      <th>Driving time</th>
                      <th>Max speed</th>
                      <th>Avg speed</th>
                      <th>Stops</th>
                      <th>Longest stop</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.technicians.map((row) => (
                      <tr key={row.technicianId}>
                        <td data-label="Technician">
                          <strong>{row.name}</strong>
                          <small>{row.employeeNumber}</small>
                        </td>
                        <td data-label="Trips">{row.totalTrips}</td>
                        <td data-label="Distance">{kilometers(row.totalDistanceMeters)}</td>
                        <td data-label="Driving time">{duration(row.totalDrivingSeconds)}</td>
                        <td data-label="Max speed">{speed(row.maxSpeed)}</td>
                        <td data-label="Avg speed">{speed(row.averageSpeed)}</td>
                        <td data-label="Stops">{row.totalStops}</td>
                        <td data-label="Longest stop">{duration(row.longestStopSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </AppShell>
  );
}
