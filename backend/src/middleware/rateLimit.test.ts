import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { bearerKey } from './rateLimit';

/** Only the two fields bearerKey reads; the cast keeps the test free of a full Request. */
function request(authorization?: string, ip = '203.0.113.7'): Request {
  return { headers: authorization ? { authorization } : {}, ip } as unknown as Request;
}

describe('bearerKey', () => {
  it('separates phones that share one public IP', () => {
    const first = bearerKey(request('Bearer device-token-a', '203.0.113.7'));
    const second = bearerKey(request('Bearer device-token-b', '203.0.113.7'));

    expect(first).not.toBe(second);
    expect(first.startsWith('token:')).toBe(true);
    expect(second.startsWith('token:')).toBe(true);
  });

  it('follows the same token even when its address changes', () => {
    expect(bearerKey(request('Bearer device-token-a', '203.0.113.7'))).toBe(
      bearerKey(request('Bearer device-token-a', '198.51.100.9')),
    );
  });

  it('never exposes the token itself in the bucket key', () => {
    const key = bearerKey(request('Bearer super-secret-device-token'));
    expect(key).not.toContain('super-secret-device-token');
  });

  it('falls back to the address when no credential is sent', () => {
    expect(bearerKey(request(undefined, '198.51.100.9'))).toBe('ip:198.51.100.9');
  });
});
