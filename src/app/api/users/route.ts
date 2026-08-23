import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { recordAudit } from "@/lib/audit";
import { checkRate, tooManyRequests } from "@/lib/rate-limit";
import { getDb } from "@/lib/db";
import { createUser, DuplicateEmailError, listUsers } from "@/lib/users";
import { createUserSchema, toFieldErrors } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = requirePermission(req, "user:manage");
  if (!guard.ok) return guard.response;
  return NextResponse.json({ users: listUsers() });
}

export async function POST(req: Request) {
  const guard = requirePermission(req, "user:manage");
  if (!guard.ok) return guard.response;

  const gate = checkRate(req, "write", { identity: guard.principal.id });
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSeconds);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = createUserSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid account", fields: toFieldErrors(parsed.error) },
      { status: 422 }
    );
  }

  try {
    // Somebody else chose this password, so it is a starting credential rather
    // than a secret: the account must replace it before it can do anything.
    const db = getDb();
    const user = db.transaction(() => {
      const created = createUser({ ...parsed.data, mustChangePassword: true }, db);
      recordAudit(
        {
          principal: guard.principal,
          entityType: "account",
          entityId: created.id,
          entityLabel: created.email,
          action: "create",
          summary: `${created.name} — ${created.role}`,
        },
        db
      );
      return created;
    })();

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return NextResponse.json(
        { error: "Invalid account", fields: [{ field: "email", message: "is already in use" }] },
        { status: 409 }
      );
    }
    // A grant naming a project that does not exist trips the foreign key.
    return NextResponse.json(
      {
        error: "Invalid account",
        fields: [{ field: "projects", message: "names a project that does not exist" }],
      },
      { status: 422 }
    );
  }
}
