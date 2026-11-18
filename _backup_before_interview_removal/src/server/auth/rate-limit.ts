/** Fixed-window limiter kept in memory (one server process). Use Redis if you run several instances. */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  if (buckets.size > 10_000) for (const [bucketKey, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(bucketKey);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
}

export function resetRateLimits() { buckets.clear(); }
