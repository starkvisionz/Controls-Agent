import { NextResponse } from "next/server";
import { authMode, issueSession, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { requireUser } from "@/lib/guard";
import { checkRate, tooManyRequests } from "@/lib/rate-limit";
import { findUserById, setOwnPassword, verifyPassword } from "@/lib/users";
import { changePasswordSchema, toFieldErrors } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Changing your own password. Administrators reset other people's via /api/users. */
export async function POST(req: Request) {
  const guard = requireUser(req);
  if (!guard.ok) return guard.response;

  const { principal } = guard;
  if (principal.development) {
    return NextResponse.json(
      { error: "There is no account to change while running unauthenticated." },
      { status: 400 }
    );
  }

  // Keyed on the account: the current password is being checked here too, so
  // the same guessing bound applies as at the login page.
  const gate = checkRate(req, "login", { identity: principal.id });
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSeconds);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid password change", fields: toFieldErrors(parsed.error) },
      { status: 422 }
    );
  }

  const user = findUserById(principal.id);
  if (!verifyPassword(parsed.data.current_password, user?.password_hash)) {
    return NextResponse.json(
      { error: "Invalid password change", fields: [{ field: "current_password", message: "is not correct" }] },
      { status: 422 }
    );
  }

  setOwnPassword(principal.id, parsed.data.new_password);

  // The change bumps session_version, which revokes every cookie issued before
  // it — including this caller's. Re-issuing here means the person who made the
  // change stays signed in and everyone holding a stolen copy does not.
  const res = NextResponse.json({ ok: true });
  const mode = authMode();
  const refreshed = findUserById(principal.id);
  if (mode.kind === "enforced" && refreshed) {
    res.cookies.set(SESSION_COOKIE, issueSession(refreshed, mode.secret), sessionCookieOptions);
  }
  return res;
}
