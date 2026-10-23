import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

type Bucket = { count: number; resetAt: number };

/**
 * Bucket key for a route authenticated by a bearer token.
 *
 * The token, not the IP, is the identity that matters on the phone routes: keying
 * by IP puts every phone behind one office NAT in a single bucket, so a fleet
 * updating from the same Wi-Fi would lock the eleventh phone out of admin
 * verification. Only a truncated hash is held in memory; the token is never logged.
 */
export function bearerKey(req: Request): string {
  const raw = req.headers.authorization?.replace('Bearer ', '').trim();
  if (raw) return `token:${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;
  return `ip:${req.ip || 'unknown'}`;
}

/**
 * Dependency-free fixed-window limiter. Adequate for a single backend container;
 * place a reverse proxy or Redis-backed limiter in front for horizontal scaling.
 */
export function rateLimit(options: { windowMs: number; max: number; key?: (req: Request) => string } = { windowMs: 60_000, max: 300 }) {
  const buckets = new Map<string, Bucket>();
  const key = options.key ?? ((req: Request) => req.ip || 'unknown');

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const bucketKey = key(req);
    const bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt < now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + options.windowMs });
      res.setHeader('X-RateLimit-Remaining', String(options.max - 1));
      return next();
    }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)));
    if (bucket.count > options.max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests' });
    }
    next();
  };
}
