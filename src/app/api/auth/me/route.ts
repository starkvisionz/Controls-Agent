import { NextResponse } from "next/server";
import { authMode } from "@/lib/auth";
import { requireUser } from "@/lib/guard";
import { permissionsOf, roleOnProject } from "@/lib/rbac";
import { findUserById } from "@/lib/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Who the caller is and what they may do.
 *
 * The UI reads this once and uses it to decide what to offer. It is a
 * convenience for the interface, never the check itself — every route
 * re-authorises independently, so a client that ignores this learns nothing and
 * gains nothing.
 */
export async function GET(req: Request) {
  const guard = requireUser(req);
  if (!guard.ok) return guard.response;

  const { principal } = guard;
  const row = principal.development ? undefined : findUserById(principal.id);

  return NextResponse.json({
    user: {
      id: principal.id,
      email: principal.email,
      name: principal.name,
      role: principal.role,
      development: principal.development,
      must_change_password: row?.must_change_password === 1,
      permissions: permissionsOf(principal),
      // The switcher needs to know which projects are in reach and at what
      // role, so it can label a project the holder can only read.
      projects: principal.grants.map((g) => ({
        project_id: g.project_id,
        role: roleOnProject(principal, g.project_id),
      })),
      scoped: principal.grants.length > 0,
    },
    authEnforced: authMode().kind === "enforced",
  });
}
