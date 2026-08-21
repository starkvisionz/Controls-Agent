/**
 * In-process rate limiting.
 *
 * Scoped to what a single-instance deployment needs: stop one caller from
 * grinding the database, filling the conversation table, or spending the
 * account's Claude tokens. It is per-process and resets on restart — adequate
 * for one Node instance, and honestly not adequate for a horizontally scaled
 * deployment, which would need a shared store.
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
  /**
   * Login: slow enough that guessing over the network is not viable.
   *
   * Sized for the shared bucket, which is what an instance behind no declared
   * proxy uses: a controls team arriving in the morning must not lock itself
   * out. Sustained, this is three attempts a minute against a twelve-character
   * minimum — not a rate anyone guesses a password at.
   */
  login: { capacity: 10, refillPerSecond: 1 / 20 },
} satisfies Record<string, Limit>;

/**
 * A second ceiling covering everyone at once.
 *
 * The per-client limit assumes client identity means something. Even when it
 * does, a spread of addresses would each get a full allowance, so these bound
 * the total: whatever the origin of the traffic, the instance will not exceed
 * this rate.
 */
export const GLOBAL_LIMITS = {
  chat: { capacity: 40, refillPerSecond: 1 / 3 },
  write: { capacity: 240, refillPerSecond: 6 },
  login: { capacity: 25, refillPerSecond: 1 / 10 },
} satisfies Record<keyof typeof LIMITS, Limit>;

export type Scope = keyof typeof LIMITS;

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

// ---------------------------------------------------------------------------
// Client identity
// ---------------------------------------------------------------------------

/**
 * How many reverse proxies sit in front of this instance, from
 * `STARKVISIONZ_TRUSTED_PROXIES`. Zero — the default — means the app is reached
 * directly and no forwarding header may be believed.
 */
function trustedProxyCount(): number {
  const raw = Number(process.env.STARKVISIONZ_TRUSTED_PROXIES ?? 0);
  return Number.isInteger(raw) && raw > 0 ? raw : 0;
}

/**
 * Resolves the address to rate-limit against.
 *
 * `X-Forwarded-For` is a list that each proxy appends to, and anything the
 * client sent arrives as the *leftmost* entries. Keying on the left of that
 * list is therefore keying on a value the caller chooses: send a different one
 * each request and every request gets a fresh bucket, which defeats the limit
 * entirely rather than merely weakening it.
 *
 * So the header is believed only when the operator has declared how many
 * proxies are in front, and then only the entry the innermost trusted proxy
 * observed is used. With N trusted hops the rightmost N entries were written by
 * infrastructure the operator controls; the one before them is the address that
 * infrastructure saw, and everything further left is caller-supplied noise.
 *
 * Returns null when no trustworthy address is available, which the caller must
 * treat as "share one bucket" rather than "no limit".
 */
export function clientAddress(req: Request): string | null {
  const hops = trustedProxyCount();
  if (hops === 0) return null;

  const chain = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (chain.length === 0) {
    // A single-hop proxy that overwrites rather than appends puts the address
    // in X-Real-IP instead.
    return hops === 1 ? (req.headers.get("x-real-ip")?.trim() || null) : null;
  }

  // Clamped so a chain shorter than the declared hop count cannot walk off the
  // front of the list into caller-supplied territory.
  const index = Math.max(0, chain.length - hops);
  return chain[index] ?? null;
}

/**
 * Bucket key for a request.
 *
 * With no trustworthy address, every caller shares one bucket for the scope.
 * That throttles legitimate users together, which is the safe direction to be
 * wrong in — the alternative is an unenforced limit.
 */
export function clientKey(req: Request, scope: Scope, identity?: string): string {
  // A signed-in account is a far better identity than an address: it survives a
  // changed IP, it is not caller-forgeable, and it stops one person on a shared
  // office address from consuming everybody else's allowance.
  if (identity) return `${scope}:user:${identity}`;
  return `${scope}:${clientAddress(req) ?? "shared"}`;
}

/**
 * The check every limited route runs: the caller's own allowance and the
 * instance-wide ceiling, both of which must have room.
 */
export function checkRate(
  req: Request,
  scope: Scope,
  options: { identity?: string; now?: number } = {}
): RateResult {
  const now = options.now ?? Date.now();
  const perClient = consume(clientKey(req, scope, options.identity), LIMITS[scope], now);
  if (!perClient.allowed) return perClient;

  return consume(`global:${scope}`, GLOBAL_LIMITS[scope], now);
}

/** 429 with the headers a well-behaved client will honour. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: "Too many requests", retryAfterSeconds }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}
