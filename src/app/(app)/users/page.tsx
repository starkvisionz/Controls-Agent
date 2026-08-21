import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { UsersView } from "@/components/users/UsersView";
import { SESSION_COOKIE, resolveSessionToken } from "@/lib/auth";
import { can } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * Checked here as well as in `/api/users`, so a non-administrator who types the
 * URL gets sent away rather than shown an empty table that failed to load.
 */
export default async function UsersPage() {
  const resolved = resolveSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!resolved.ok || !can(resolved.principal, "user:manage")) redirect("/");

  return <UsersView />;
}
