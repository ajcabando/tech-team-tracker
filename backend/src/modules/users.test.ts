import { describe, expect, it } from 'vitest';

/**
 * Owner password-reset validation — mirrors POST /api/users/:id/password.
 * The schema is re-defined here (same pattern as settings.test.ts) so the test
 * runs without importing the router and its DB dependencies.
 */
import { z } from 'zod';

const resetPasswordBody = z.object({
  newPassword: z.string().min(12).max(128),
  confirmPassword: z.string().min(1),
});

function acceptsReset(body: unknown): boolean {
  const parsed = resetPasswordBody.safeParse(body);
  return parsed.success && parsed.data.newPassword === parsed.data.confirmPassword;
}

describe('owner password-reset validation', () => {
  it('accepts matching passwords of 12+ characters', () => {
    expect(acceptsReset({ newPassword: 'correct-horse-12', confirmPassword: 'correct-horse-12' })).toBe(true);
  });

  it('rejects mismatched passwords', () => {
    expect(acceptsReset({ newPassword: 'correct-horse-12', confirmPassword: 'correct-horse-13' })).toBe(false);
  });

  it('rejects passwords shorter than 12 characters', () => {
    expect(acceptsReset({ newPassword: 'short-11-ch', confirmPassword: 'short-11-ch' })).toBe(false);
  });

  it('rejects passwords longer than 128 characters', () => {
    const long = 'a'.repeat(129);
    expect(acceptsReset({ newPassword: long, confirmPassword: long })).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(acceptsReset({})).toBe(false);
    expect(acceptsReset({ newPassword: 'correct-horse-12' })).toBe(false);
  });
});
