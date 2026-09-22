import { Router } from 'express';
import { config } from './config';

const json = { type: 'object', additionalProperties: true } as const;
const security = [{ bearerAuth: [] }];

function operation(summary: string, tags: string[], secured = true, requestBody?: object) {
  return {
    summary,
    tags,
    ...(secured ? { security } : {}),
    ...(requestBody ? { requestBody: { required: true, content: { 'application/json': { schema: requestBody } } } } : {}),
    responses: { '200': { description: 'Success', content: { 'application/json': { schema: json } } }, '400': { description: 'Bad request' }, '401': { description: 'Unauthenticated' }, '403': { description: 'Forbidden' } },
  };
}

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Multi-Technician GPS Tracking Platform API',
    version: config.version,
    description: 'REST API for technician GPS tracking, trips, reports, branding, and administration.',
    license: { name: 'MIT' },
  },
  servers: [{ url: '/', description: 'Current host' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      LocationPoint: {
        type: 'object',
        required: ['id', 'recordedAt', 'latitude', 'longitude'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          recordedAt: { type: 'string', format: 'date-time' },
          latitude: { type: 'number' },
          longitude: { type: 'number' },
          speed: { type: 'number', description: 'Speed in km/h' },
          heading: { type: 'number' },
          accuracy: { type: 'number' },
          altitude: { type: 'number' },
          battery: { type: 'integer' },
          networkState: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/health': { get: operation('Service health', ['health'], false) },
    '/health/database': { get: operation('Database health', ['health'], false) },
    '/health/version': { get: operation('Build version', ['health'], false) },
    '/api/setup/status': { get: operation('Whether first-run setup is complete', ['setup'], false) },
    '/api/setup': { post: operation('Initialize the system (first run only)', ['setup'], false, json) },
    '/api/branding/public': { get: operation('Public branding for the login screen', ['branding'], false) },
    '/api/auth/login': { post: operation('Sign in', ['auth'], false, json) },
    '/api/auth/refresh': { post: operation('Rotate a refresh token', ['auth'], false, json) },
    '/api/auth/logout': { post: operation('Revoke a refresh token', ['auth'], false, json) },
    '/api/auth/me': { get: operation('Current user profile', ['auth']) },
    '/api/auth/change-password': { post: operation('Change your password', ['auth'], true, json) },
    '/api/organizations': { get: operation('List organizations (superadmin)', ['organizations']), post: operation('Create an organization (superadmin)', ['organizations'], true, json) },
    '/api/organizations/{id}': {
      patch: operation('Update an organization (superadmin)', ['organizations'], true, json),
      delete: operation('Remove an organization (409 while it holds data; ?purge=true erases it)', ['organizations']),
    },
    '/api/users': { get: operation('List users', ['users']), post: operation('Create a user', ['users'], true, json) },
    '/api/users/{id}': { delete: operation('Remove a user account (refuses your own account and the last superadmin)', ['users']) },
    '/api/users/{id}/status': { patch: operation('Enable or disable a user', ['users'], true, json) },
    '/api/technicians': { get: operation('List technicians', ['technicians']), post: operation('Create a technician', ['technicians'], true, json) },
    '/api/technicians/{id}': {
      get: operation('Technician detail with today totals', ['technicians']),
      patch: operation('Update a technician', ['technicians'], true, json),
      delete: operation('Remove a technician (409 while history exists; ?purge=true erases it)', ['technicians']),
    },
    '/api/technicians/{id}/locations': { get: operation('GPS history for a technician', ['technicians']) },
    '/api/devices': { get: operation('List devices', ['devices']) },
    '/api/devices/{id}': {
      get: operation('Device detail', ['devices']),
      delete: operation('Remove a device (409 while history exists; ?purge=true erases it)', ['devices']),
    },
    '/api/devices/pairing-code': { post: operation('Generate a single-use pairing code', ['devices'], true, json) },
    '/api/devices/pair': { post: operation('Pair a phone with a pairing code', ['devices'], false, json) },
    '/api/devices/{id}/unpair': { post: operation('Unpair a device (keeps history)', ['devices']) },
    '/api/device/config': { get: operation('Paired-device configuration (device token)', ['devices'], true) },
    '/api/locations/batch': { post: operation('Upload a batch of GPS points (device token)', ['locations'], true, json) },
    '/api/dashboard/live': { get: operation('Live device positions', ['dashboard']) },
    '/api/dashboard/summary': { get: operation('Dashboard counters', ['dashboard']) },
    '/api/dashboard/stream': { get: operation('Server-Sent Events live stream', ['dashboard']) },
    '/api/trips': { get: operation('List trips with filters', ['trips']) },
    '/api/trips/{id}': { get: operation('Trip detail', ['trips']) },
    '/api/trips/{id}/route': { get: operation('Raw GPS route for a trip', ['trips']) },
    '/api/trips/{id}/replay': { get: operation('Replay timeline for a trip', ['trips']) },
    '/api/trips/{id}/stops': { get: operation('Stops detected within a trip', ['trips']) },
    '/api/trips/process': { post: operation('Manually detect a trip over a window', ['trips'], true, json) },
    '/api/reports/daily': { get: operation('Daily report', ['reports']) },
    '/api/reports/weekly': { get: operation('Weekly report', ['reports']) },
    '/api/reports/monthly': { get: operation('Monthly report', ['reports']) },
    '/api/settings': { get: operation('Branding settings', ['settings']), post: operation('Update branding settings', ['settings'], true, json) },
    '/api/settings/tracking': { get: operation('Tracking settings', ['settings']), put: operation('Update tracking settings', ['settings'], true, json) },
    '/api/settings/retention': { get: operation('Retention settings', ['settings']), put: operation('Update retention settings', ['settings'], true, json) },
    '/api/alerts': { get: operation('List alerts', ['alerts']) },
    '/api/alerts/{id}/acknowledge': { post: operation('Acknowledge an alert', ['alerts']) },
    '/api/audit-logs': { get: operation('List audit log entries', ['audit']) },
    '/api/maintenance/retention': { post: operation('Apply retention windows now', ['audit']) },
  },
} as const;

export const openApiRouter = Router();

openApiRouter.get('/api/openapi.json', (_req, res) => res.json(openApiDocument));

openApiRouter.get('/api/docs', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Tracker API documentation</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.onload = () => window.SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger' });
    </script>
  </body>
</html>`);
});
