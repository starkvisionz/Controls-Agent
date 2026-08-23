import { NextResponse } from "next/server";
import { auditForAccounts, auditForEntity, auditForProject } from "@/lib/audit";
import { requireProjectRead, requirePermission, requireUser } from "@/lib/guard";
import { one } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reading the log.
 *
 * Three shapes, each with its own audience:
 *
 * - `?project=` — everything that happened on one project, for anyone who can
 *   read it. A project's history belongs to the people working on it.
 * - `?entity=&id=` — one record's history, for the inspectors. Authorised
 *   against the project that record belongs to, not the caller's assertion.
 * - `?scope=accounts` — who changed whose access, administrators only. A
 *   planner should see who moved an activity; only an administrator should see
 *   who changed somebody's role.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("project");
  const entityType = url.searchParams.get("entity");
  const entityId = url.searchParams.get("id");
  const scope = url.searchParams.get("scope");

  if (scope === "accounts") {
    const guard = requirePermission(req, "user:manage");
    if (!guard.ok) return guard.response;
    return NextResponse.json({ events: auditForAccounts() });
  }

  if (entityType && entityId) {
    const owner = projectOf(entityType, entityId);
    if (!owner) return NextResponse.json({ events: [] });

    const guard = requireProjectRead(req, owner);
    if (!guard.ok) return guard.response;
    return NextResponse.json({ events: auditForEntity(entityType, entityId) });
  }

  if (projectId) {
    const guard = requireProjectRead(req, projectId);
    if (!guard.ok) return guard.response;
    return NextResponse.json({ events: auditForProject(projectId) });
  }

  const guard = requireUser(req);
  if (!guard.ok) return guard.response;
  return NextResponse.json(
    { error: "Ask for ?project=, ?entity=&id=, or ?scope=accounts" },
    { status: 400 }
  );
}

/**
 * Which project a record belongs to.
 *
 * Read from the record itself rather than taken from the query, so a caller
 * cannot pair another project's record id with a project they can read and
 * pull its history out.
 */
function projectOf(entityType: string, entityId: string): string | null {
  const table = {
    task: "tasks",
    risk: "risks",
    document: "documents",
    change_order: "change_orders",
  }[entityType];

  if (!table) return null;

  const row = one<{ project_id: string }>(
    `SELECT project_id FROM ${table} WHERE id = ?`,
    [entityId]
  );
  return row?.project_id ?? null;
}
