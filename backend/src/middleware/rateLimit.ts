import { NextFunction, Request, Response } from 'express';

type Bucket = { count: number; resetAt: number };

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
