import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/session-cookie";

/**
 * Single-operator authentication.
 *
 * Hermes holds a project's cost, schedule and commercial position — the kind of
 * data that should never be readable, and certainly never writable, by whoever
 * happens to find the host. This module gates the whole application behind one
 * operator credential, which is the right shape for a single-instance install.
 * Multi-user access with per-project roles is a larger change and deliberately
 * not attempted here.
 *
 * Design notes:
 * - The session is a signed, expiring cookie. There is no server-side session
 *   store to lose on restart, and no session id worth stealing from the DB.
 * - Comparisons are constant-time; a timing oracle on the password or the
 *   signature would defeat the point.
 * - Production without a configured password fails CLOSED. An unauthenticated
 *   controls system on the public internet is the failure this exists to stop,
 *   so it must never be the default when configuration is missing.
 */

export { SESSION_COOKIE };

export type AuthMode =
  | { kind: "enforced"; secret: string }
  /** Localhost development with no password set: open, and says so loudly. */
  | { kind: "open"; reason: string }
  /** Production with no password set: refuse to serve rather than serve nude. */
  | { kind: "misconfigured"; reason: string };

function envValue(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/**
 * Resolves how the app should behave given the current configuration. Called on
 * every request so a deployment cannot be left in a state the operator believes
 * is protected but is not.
 */
export function authMode(): AuthMode {
  const password = envValue("HERMES_AUTH_PASSWORD");
  const secret = envValue("HERMES_SESSION_SECRET");
  const isProduction = process.env.NODE_ENV === "production";

  if (!password) {
    return isProduction
      ? {
          kind: "misconfigured",
          reason:
            "HERMES_AUTH_PASSWORD is not set. Hermes will not serve project data " +
            "unauthenticated in production.",
        }
      : {
          kind: "open",
          reason: "HERMES_AUTH_PASSWORD is not set — running unauthenticated for local development.",
        };
  }

  if (!secret) {
    return isProduction
      ? {
          kind: "misconfigured",
          reason: "HERMES_SESSION_SECRET is not set. Session cookies cannot be signed.",
        }
      : {
          kind: "open",
          reason: "HERMES_SESSION_SECRET is not set — running unauthenticated for local development.",
        };
  }

  return { kind: "enforced", secret };
}

export function isAuthEnforced(): boolean {
  return authMode().kind === "enforced";
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

/** Length-safe constant-time comparison. */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    // Still compare, so a wrong length costs the same as a wrong value.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * Checks a submitted password.
 *
 * `HERMES_AUTH_PASSWORD` may hold either a `scrypt$<saltHex>$<hashHex>` digest
 * (preferred — see `npm run auth:hash`) or a plain string, so an operator can
 * get running quickly and harden later without a code change.
 */
export function verifyPassword(submitted: string): boolean {
  const configured = envValue("HERMES_AUTH_PASSWORD");
  if (!configured) return false;

  if (configured.startsWith("scrypt$")) {
    const [, saltHex, hashHex] = configured.split("$");
    if (!saltHex || !hashHex) return false;
    try {
      const expected = Buffer.from(hashHex, "hex");
      const actual = scryptSync(submitted, Buffer.from(saltHex, "hex"), expected.length);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }

  return safeEqual(submitted, configured);
}

/** Produces the `scrypt$salt$hash` form for HERMES_AUTH_PASSWORD. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, 32);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Session token
// ---------------------------------------------------------------------------

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** `<issuedAt>.<expiresAt>.<signature>` — no secrets, no PII, just a bearer. */
export function issueSession(secret: string, now = Date.now()): string {
  const issued = Math.floor(now / 1000);
  const expires = issued + SESSION_TTL_SECONDS;
  const payload = `${issued}.${expires}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [issued, expires, signature] = parts;
  const payload = `${issued}.${expires}`;
  if (!safeEqual(signature, sign(payload, secret))) return false;

  const expiresAt = Number(expires);
  return Number.isFinite(expiresAt) && expiresAt * 1000 > now;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
  // Set on HTTPS deployments; left off locally so login works over plain http.
  secure: process.env.NODE_ENV === "production",
};
