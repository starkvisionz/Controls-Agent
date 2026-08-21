import type Database from "better-sqlite3";
import { getDb } from "@/lib/db";
// The implementation is plain JS so `scripts/seed.mjs` runs the exact same
// roll-up the API does. One definition, two callers.
import { recalculateProject as core } from "@/lib/rollup-core.mjs";

/**
 * Re-derives control-account earned value, forecast at completion, and the
 * current EVM period from activity progress. See `rollup-core.mjs` for the
 * chain this walks and why actual cost is excluded from it.
 */
export function recalculateProject(projectId: string, db: Database.Database = getDb()): void {
  core(db, projectId);
}

/** Convenience for callers holding a task id rather than a project id. */
export function recalculateForTask(taskId: string, db: Database.Database = getDb()): void {
  const row = db.prepare(`SELECT project_id FROM tasks WHERE id = ?`).get(taskId) as
    | { project_id: string }
    | undefined;
  if (row) core(db, row.project_id);
}
