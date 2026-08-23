import { getDb } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { applyChangeOrders } from "@/lib/change-orders";
import { recalculateProject } from "@/lib/rollup";
import type { Principal } from "@/lib/rbac";
import { REGISTERS, type RegisterKey } from "./registers";
import type { ImportPlan } from "./plan";

/**
 * Applying a plan.
 *
 * One transaction for the whole file. A part-applied import is the worst
 * outcome available: the register disagrees with the source, and nobody can
 * tell which half took without reading both. Rows that were already rejected in
 * the plan are simply not applied — they never reach here as writes — but every
 * row that does apply, applies together.
 *
 * The roll-ups run once at the end rather than per row. Recalculating a
 * three-hundred-activity project three hundred times produces the same answer
 * several seconds later.
 */

export type CommitResult = {
  applied: number;
  skipped: number;
  /** The audit event id, so the UI can point at what was recorded. */
  auditId?: string;
};

export function commitPlan(
  register: RegisterKey,
  projectId: string,
  plan: ImportPlan,
  principal: Principal,
  source: { fileName: string; format: string }
): CommitResult {
  const spec = REGISTERS[register];
  const db = getDb();

  const updates = plan.rows.filter((r) => r.outcome === "update" && r.id);
  const skipped = plan.rows.length - updates.length;

  if (updates.length === 0) return { applied: 0, skipped };

  const write = db.transaction(() => {
    for (const row of updates) {
      const patch: Record<string, unknown> = {};
      for (const change of row.changes) patch[change.field] = change.to;

      const entries = Object.entries(patch);
      if (entries.length === 0) continue;

      db.prepare(
        `UPDATE ${spec.table} SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`
      ).run(...entries.map(([, v]) => v as never), row.id);

      // Each record gets its own audit entry, so the history strip on an
      // activity shows the import the same way it shows a typed edit.
      recordAudit(
        {
          principal,
          projectId,
          entityType: auditEntity(register),
          entityId: row.id!,
          entityLabel: row.label,
          action: "update",
          summary: `imported from ${source.fileName}`,
          changes: row.changes,
        },
        db
      );
    }

    // Derived columns the registers maintain on write, applied once for the
    // whole file rather than per row.
    if (register === "tasks") {
      db.prepare(
        `UPDATE tasks SET percent_complete = 100 WHERE project_id = ? AND status = 'complete'`
      ).run(projectId);
      db.prepare(
        `UPDATE tasks SET percent_complete = 0 WHERE project_id = ? AND status = 'not-started'`
      ).run(projectId);
      db.prepare(
        `UPDATE tasks SET earned_value = budget * (percent_complete / 100.0) WHERE project_id = ?`
      ).run(projectId);
      recalculateProject(projectId, db);
    }

    if (register === "risks") {
      db.prepare(
        `UPDATE risks
            SET severity = probability * impact,
                expected_value = CASE WHEN status = 'closed' THEN 0
                                      ELSE cost_impact * (probability / 5.0) END
          WHERE project_id = ?`
      ).run(projectId);
    }

    if (register === "change-orders") {
      // Budgets are derived from the register, so an import that moved an
      // order's status or value has to re-derive them.
      applyChangeOrders(projectId, db);
    }
  });

  write();

  return { applied: updates.length, skipped };
}

function auditEntity(register: RegisterKey): "task" | "risk" | "document" | "change_order" {
  return register === "tasks"
    ? "task"
    : register === "risks"
      ? "risk"
      : register === "documents"
        ? "document"
        : "change_order";
}
