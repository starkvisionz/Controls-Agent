import { NextResponse } from "next/server";
import { resolvePrincipal } from "@/lib/auth";
import { can, roleOnProject, type Permission, type Principal } from "@/lib/rbac";

/**
 * The authorisation guard every API route runs first.
 *
 * Two rules make this hard to get subtly wrong:
 *
 *  1. It returns a discriminated union, so a route cannot use `principal`
 *     without having handled the denial — TypeScript refuses to compile the
 *     version that forgets.
 *  2. Every data route passes the project it is about. A permission check
 *     without a project would ask "could this account ever do this?", which is
 *     the wrong question the moment a user is scoped to a subset of the
 *     portfolio.
 */

export type Guard =
  | { ok: true; principal: Principal }
  | { ok: false; response: NextResponse };

function deny(status: number, error: string): { ok: false; response: NextResponse } {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/**
 * Authentication only — for endpoints about the caller rather than a project.
 *
 * An account still on a starting password somebody else set is refused
 * everything until it picks its own. The sign-in screen already asks for a
 * replacement, but that is the client asking: a caller holding the starting
 * password can skip the page and use the API directly, which is the whole
 * value of the password an administrator just read out or a deploy printed.
 * `allowPendingPasswordChange` is for the two endpoints that have to keep
 * working while it is pending — reading who you are, and setting the new one.
 */
export function requireUser(
  req: Request,
  { allowPendingPasswordChange = false }: { allowPendingPasswordChange?: boolean } = {}
): Guard {
  const resolved = resolvePrincipal(req);
  if (!resolved.ok) return deny(resolved.status, resolved.reason);

  if (resolved.principal.mustChangePassword && !allowPendingPasswordChange) {
    return deny(403, "Set a new password before using this account.");
  }

  return { ok: true, principal: resolved.principal };
}

/**
 * Authentication plus a permission.
 *
 * Omitting `projectId` asks about an instance-wide power. Every route touching
 * project data supplies one.
 */
export function requirePermission(req: Request, permission: Permission, projectId?: string): Guard {
  const resolved = requireUser(req);
  if (!resolved.ok) return resolved;

  const { principal } = resolved;
  if (can(principal, permission, projectId)) return resolved;

  // A user with no role on the project is told the project is not there, not
  // that it exists and is closed to them. The portfolio a competitor is bidding
  // against should not be enumerable from an error code.
  if (projectId !== undefined && roleOnProject(principal, projectId) === null) {
    return deny(404, "Project not found");
  }

  return deny(403, `Your role (${principal.role}) does not allow this.`);
}

/** Read access to one project — the guard nearly every GET wants. */
export function requireProjectRead(req: Request, projectId: string): Guard {
  return requirePermission(req, "project:read", projectId);
}
