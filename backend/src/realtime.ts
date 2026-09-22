import { Response } from 'express';

type Client = { id: number; organizationId?: string; role: string; res: Response };

const clients = new Set<Client>();
let nextId = 1;

export function subscribe(res: Response, user: { organizationId?: string; role: string }): Client {
  const client: Client = { id: nextId++, organizationId: user.organizationId, role: user.role, res };
  clients.add(client);
  res.write('event: ready\ndata: {"connected":true}\n\n');
  return client;
}

export function unsubscribe(client: Client): void {
  clients.delete(client);
}

type Payload = Record<string, unknown>;

export type LiveEvent =
  | { type: 'location'; organizationId: string; payload: Payload }
  | { type: 'device'; organizationId: string; payload: Payload }
  | { type: 'trip'; organizationId: string; payload: Payload }
  | { type: 'alert'; organizationId: string; payload: Payload };

/** Fan out an event to every dashboard client permitted to see the organization. */
export function publish(event: LiveEvent): void {
  const body = `event: ${event.type}\ndata: ${JSON.stringify({ ...event.payload, organizationId: event.organizationId })}\n\n`;
  for (const client of clients) {
    const allowed = client.role === 'SUPERADMIN' || client.organizationId === event.organizationId;
    if (!allowed) continue;
    try {
      client.res.write(body);
    } catch {
      clients.delete(client);
    }
  }
}

export function subscriberCount(): number {
  return clients.size;
}
