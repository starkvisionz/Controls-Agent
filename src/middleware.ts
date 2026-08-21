import { NextResponse, type NextRequest } from "next/server";
// Imported from its own module: `@/lib/auth` pulls in node:crypto and the
// database, neither of which the edge runtime can resolve.
import { SESSION_COOKIE, SESSION_TAG } from "@/lib/session-cookie";

/**
 * The outer gate. Every page and every API route passes through here.
 *
 * Middleware runs on the edge runtime, so it does the cheap half of the check —
 * is there a well-formed, unexpired, correctly signed session cookie — using
 * Web Crypto rather than node:crypto. It deliberately does NOT decide what the
 * holder may do: roles, project scoping and revocation all live in the
 * database, which this layer cannot reach. That is `src/lib/guard.ts`, which
 * every route runs on the Node side.
 *
 * The division matters. This layer exists so an unauthenticated request never
 * reaches the database at all; it is not, and must not be mistaken for, the
 * authorisation check.
 */

const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout"]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Next's own assets and the app icon must load before a session exists.
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg"
  );
}

async function signatureIsValid(payload: string, signature: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));

  // base64url without Buffer, which is not guaranteed on the edge runtime.
  const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return expected.length === signature.length && expected === signature;
}

/** `v2.<userId>.<sessionVersion>.<issuedAt>.<expiresAt>.<signature>` */
async function hasValidSession(token: string | undefined, secret: string): Promise<boolean> {
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== SESSION_TAG) return false;

  const [tag, userId, version, issued, expires, signature] = parts;
  if (!(await signatureIsValid(`${tag}.${userId}.${version}.${issued}.${expires}`, signature, secret))) {
    return false;
  }

  const expiresAt = Number(expires);
  return Number.isFinite(expiresAt) && expiresAt * 1000 > Date.now();
}

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const secret = process.env.STARKVISIONZ_SESSION_SECRET?.trim();
  const isProduction = process.env.NODE_ENV === "production";

  // Unconfigured in production: refuse outright rather than serve the project
  // registers to anyone who can reach the host.
  if (isProduction && !secret) {
    return NextResponse.json(
      {
        error:
          "Starkvisionz is not configured for authenticated access. Set " +
          "STARKVISIONZ_SESSION_SECRET, create an administrator with " +
          "`npm run user -- add`, then restart.",
      },
      { status: 503 }
    );
  }

  // No secret outside production: local development stays open, and every
  // request runs as the development administrator.
  if (!secret) return NextResponse.next();

  if (isPublic(pathname)) return NextResponse.next();

  if (await hasValidSession(req.cookies.get(SESSION_COOKIE)?.value, secret)) {
    return NextResponse.next();
  }

  // An API caller wants a status code, not a redirect to an HTML page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const login = req.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  // Send them back where they were once they are through.
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except Next's build output and static files.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
