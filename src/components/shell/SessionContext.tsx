"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { can as canDo, type Permission, type Principal, type Role } from "@/lib/rbac";

/**
 * Who is signed in, and what the interface should therefore offer.
 *
 * Resolved on the server in the app layout and handed down, so there is no
 * fetch-then-flash: the first paint already knows whether this account may
 * edit. It is a rendering input only. Every route re-authorises from the
 * database, so a client that lies to this context gains nothing.
 */

export type SessionValue = {
  principal: Principal;
  /** False when no session secret is configured and nothing is being enforced. */
  enforced: boolean;
  mustChangePassword: boolean;
  /** May this account do `permission`, on `projectId` when one is in play? */
  can: (permission: Permission, projectId?: string | null) => boolean;
  role: Role;
};

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({
  principal,
  enforced,
  mustChangePassword,
  children,
}: {
  principal: Principal;
  enforced: boolean;
  mustChangePassword: boolean;
  children: ReactNode;
}) {
  const can = useCallback(
    (permission: Permission, projectId?: string | null) =>
      canDo(principal, permission, projectId ?? undefined),
    [principal]
  );

  const value = useMemo<SessionValue>(
    () => ({ principal, enforced, mustChangePassword, can, role: principal.role }),
    [principal, enforced, mustChangePassword, can]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}

/**
 * Permission for the project the shell is pointed at.
 *
 * Nearly every control in the app is about the active project, and asking
 * without one would answer the wrong question — "could this account ever" —
 * which is how a scoped user ends up shown an edit button that 404s.
 */
export function useCanOnProject(
  permission: Permission,
  projectId: string | null | undefined
): boolean {
  const { can } = useSession();
  return projectId ? can(permission, projectId) : false;
}
