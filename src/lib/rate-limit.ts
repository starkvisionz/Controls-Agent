/**
 * In-process rate limiting.
 *
 * Scoped to what a single-instance deployment needs: stop one caller from
 * grinding the database, filling the conversation table, or spending the
 * account's Claude tokens. It is per-process and resets on restart — adequate
 * for one Node instance behind one address, and honestly not adequate for a
 * horizontally scaled deployment, which would need a shared store.
 */

type Bucket = { tokens: number; updatedAt: number };

const buckets = new Map<string, Bucket>();

/** Stops the map growing without bound on a long-lived process. */
const MAX_TRACKED = 5_000;

export type Limit = { capacity: number; refillPerSecond: number };

/** Sized for a person clicking, not a script looping. */
export const LIMITS = {
  /** Agent turns: the only path that can spend money at a provider. */
  chat: { capacity: 8, refillPerSecond: 1 / 15 },
  /** Writes: generous for a progress review, hostile to a hammering client. */
  write: { capacity: 40, refillPerSecond: 1 },
  /** Login: slow enough that guessing over the network is not viable. */
  login: { capacity: 5, refillPerSecond: 1 / 60 },
} satisfies Record<string, Limit>;

export type RateResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Token bucket. Returns how long to wait when the caller is over its limit, so
 * the route can answer with a usable `Retry-After`.
 */
export function consume(key: string, limit: Limit, now = Date.now()): RateResult {
  if (buckets.size > MAX_TRACKED) buckets.clear();

  const bucket = buckets.get(key) ?? { tokens: limit.capacity, updatedAt: now };

  const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
  const tokens = Math.min(limit.capacity, bucket.tokens + elapsedSeconds * limit.refillPerSecond);

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return { allowed: false, retryAfterSeconds: Math.ceil((1 - tokens) / limit.refillPerSecond) };
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  return { allowed: true };
}

/**
 * Best-effort client identity. Behind a reverse proxy this is the forwarded
 * address; direct, it falls back to a single shared bucket, which is the safe
 * direction to be wrong in (it throttles more, not less).
 */
export function clientKey(req: Request, scope: string): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = req.headers.get("x-real-ip")?.trim();
  return `${scope}:${forwarded || real || "unknown"}`;
}

/** 429 with the headers a well-behaved client will honour. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response(
    JSON.stringify({ error: "Too many requests", retryAfterSeconds }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
}
