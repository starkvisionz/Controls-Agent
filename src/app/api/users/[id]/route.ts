import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { checkRate, tooManyRequests } from "@/lib/rate-limit";
import { countActiveAdmins, findUserById, toPublicUser, updateUser } from "@/lib/users";
import { toFieldErrors, updateUserSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = requirePermission(req, "user:manage");
  if (!guard.ok) return guard.response;

  const row = findUserById((await ctx.params).id);
  if (!row) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json({ user: toPublicUser(row) });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = requirePermission(req, "user:manage");
  if (!guard.ok) return guard.response;

  const gate = checkRate(req, "write", { identity: guard.principal.id });
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSeconds);

  const { id } = await ctx.params;
  const existing = findUserById(id);
  if (!existing) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = updateUserSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid account update", fields: toFieldErrors(parsed.error) },
      { status: 422 }
    );
  }
  const patch = parsed.data;

  // An administrator cannot demote, deactivate or re-scope themselves. Not
  // paternalism: it is the only thing standing between a mis-click and an
  // instance with nobody who can fix it.
  const self = guard.principal.id === id;
  if (self && (patch.role !== undefined || patch.is_active !== undefined || patch.projects !== undefined)) {
    return NextResponse.json(
      {
        error: "Invalid account update",
        fields: [{ field: "role", message: "cannot change your own role or access" }],
      },
      { status: 422 }
    );
  }

  // The same protection from the other direction: the last administrator
  // standing cannot be removed by another one.
  const losesAdmin =
    (patch.role !== undefined && patch.role !== "admin" && existing.role === "admin") ||
    (patch.is_active === false && existing.role === "admin");
  if (losesAdmin && countActiveAdmins(id) === 0) {
    return NextResponse.json(
      {
        error: "Invalid account update",
        fields: [{ field: "role", message: "this is the last active administrator" }],
      },
      { status: 422 }
    );
  }

  try {
    return NextResponse.json({ user: updateUser(id, patch) });
  } catch {
    return NextResponse.json(
      {
        error: "Invalid account update",
        fields: [{ field: "projects", message: "names a project that does not exist" }],
      },
      { status: 422 }
    );
  }
}
