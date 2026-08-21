import { NextResponse } from "next/server";
import { authMode, issueSession, sessionCookieOptions, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { clientKey, consume, LIMITS, tooManyRequests } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Throttle before touching the password so guessing is bounded by the clock
  // rather than by network speed.
  const gate = consume(clientKey(req, "login"), LIMITS.login);
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSeconds);

  const mode = authMode();
  if (mode.kind === "misconfigured") {
    return NextResponse.json({ error: mode.reason }, { status: 503 });
  }
  if (mode.kind === "open") {
    return NextResponse.json({ ok: true, authenticated: false, note: mode.reason });
  }

  let body: { password?: unknown };
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const submitted = typeof body.password === "string" ? body.password : "";
  // Bound the work an attacker can make scrypt do.
  if (submitted.length > 512 || !verifyPassword(submitted)) {
    return NextResponse.json({ error: "That password was not accepted." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, authenticated: true });
  res.cookies.set(SESSION_COOKIE, issueSession(mode.secret), sessionCookieOptions);
  return res;
}
