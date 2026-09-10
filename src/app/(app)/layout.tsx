import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DesktopShell } from "@/components/shell/DesktopShell";
import { SESSION_COOKIE, authMode, resolveSessionToken } from "@/lib/auth";
import { findUserById } from "@/lib/users";
import { listProjects, projectMetrics } from "@/lib/queries";
import { roleOnProject } from "@/lib/rbac";

/**
 * Everything behind the session gate renders inside the desktop shell.
 *
 * The account is resolved here rather than fetched by the client, so the first
 * paint already knows what this person may do. The middleware has refused
 * anything without a valid cookie by now; this repeats the check against the
 * database, which is where a since-revoked session is caught.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const mode = authMode();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const resolved = resolveSessionToken(token);

  if (!resolved.ok) redirect("/login");

  const row = resolved.principal.development ? undefined : findUserById(resolved.principal.id);
  const mustChangePassword = row?.must_change_password === 1;

  // The portfolio travels with the first HTML. Fetching it from the browser
  // instead put a blocking round trip in front of every page load: nothing
  // could ask for its own data until the active project was known. The same
  // filter as /api/projects, because it is the same question.
  //
  // Not while a starting password is pending, though. The shell renders the
  // password prompt instead of the registers in that state, but rendering
  // nothing is not the same as sending nothing: these rows are serialised into
  // the payload whether or not a component draws them, so a caller who never
  // chose a password would receive project names, clients and contract values
  // by reading the response. The API refuses such a session; this is the same
  // refusal, and it has to be made before the query, not after.
  const projects = mustChangePassword
    ? []
    : listProjects()
        .filter((p) => roleOnProject(resolved.principal, p.id) !== null)
        .map((p) => ({
          ...p,
          metrics: projectMetrics(p),
          role: roleOnProject(resolved.principal, p.id),
        }));

  return (
    <DesktopShell
      principal={resolved.principal}
      projects={projects}
      authEnforced={mode.kind === "enforced"}
      mustChangePassword={mustChangePassword}
    >
      {children}
    </DesktopShell>
  );
}
