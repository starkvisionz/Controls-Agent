import { NextResponse } from "next/server";
import {
  authMode,
  issueSession,
  needsBootstrap,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/auth";
import { checkRate, tooManyRequests } from "@/lib/rate-limit";
import { permissionsOf } from "@/lib/rbac";
import { findUserByEmail, recordLogin, toPrincipal, verifyPassword } from "@/lib/users";
import { loginSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Throttle before touching the password so guessing is bounded by the clock
  // rather than by network speed.
  const gate = checkRate(req, "login");
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSeconds);

  const mode = authMode();
  if (mode.kind === "misconfigured") {
    return NextResponse.json({ error: mode.reason }, { status: 503 });
  }
  if (mode.kind === "open") {
    return NextResponse.json({ ok: true, authenticated: false, note: mode.reason });
  }

  if (needsBootstrap()) {
    return NextResponse.json(
      {
        error:
          "No accounts exist yet. Create an administrator with " +
          "`npm run user -- add --email you@example.com --name 'Your Name' --role admin`.",
      },
      { status: 503 }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(raw);
  const user = parsed.success ? findUserByEmail(parsed.data.email) : undefined;

  // One answer for every failure — bad shape, unknown address, wrong password,
  // deactivated account. Distinguishing them turns this endpoint into a way to
  // find out who has an account here.
  const refuse = () =>
    NextResponse.json({ error: "Those details were not accepted." }, { status: 401 });

  if (!parsed.success) return refuse();
  // Runs the hash even with no matching row, so a miss costs what a hit costs.
  if (!verifyPassword(parsed.data.password, user?.password_hash)) return refuse();
  if (!user || user.is_active !== 1) return refuse();

  recordLogin(user.id);

  const principal = toPrincipal(user);
  const res = NextResponse.json({
    ok: true,
    authenticated: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: principal.role,
      must_change_password: user.must_change_password === 1,
      permissions: permissionsOf(principal),
    },
  });
  res.cookies.set(SESSION_COOKIE, issueSession(user, mode.secret), sessionCookieOptions);
  return res;
}
