import { NextResponse } from "next/server";
import { requireUser } from "@/lib/guard";
import { listProjects, projectMetrics } from "@/lib/queries";
import { roleOnProject } from "@/lib/rbac";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Portfolio list, each row carrying enough EVM to render the switcher.
 *
 * Filtered to what the caller may see. A scoped account gets a shorter
 * portfolio rather than a longer one with some entries greyed out — a project
 * name and contract value are commercially sensitive on their own.
 */
export async function GET(req: Request) {
  const guard = requireUser(req);
  if (!guard.ok) return guard.response;

  const { principal } = guard;
  const projects = listProjects()
    .filter((p) => roleOnProject(principal, p.id) !== null)
    .map((p) => ({
      ...p,
      metrics: projectMetrics(p),
      // The switcher labels a project the holder can only read, so nobody
      // discovers their role by clicking a control that then fails.
      role: roleOnProject(principal, p.id),
    }));

  return NextResponse.json({ projects });
}
