import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import { all, getDb } from "@/lib/db";
import type { Principal } from "@/lib/rbac";

/**
 * Who changed what.
 *
 * The rule that makes this worth having: an audit row is written by the same
 * transaction as the change it describes. A log that can disagree with the data
 * is worse than no log, because people believe it — so `recordAudit` takes the
 * database handle the caller is already writing through rather than opening its
 * own, and a rolled-back write takes its audit row with it.
 *
 * The diff is computed from the row as it stood before the write against the
 * patch, so the log says what actually moved rather than what was submitted.
 * A field sent with the value it already held is not a change and is not
 * recorded — otherwise every save looks like an edit to everything.
 */

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "approve",
  "reject",
  "disable",
  "enable",
  "reset-password",
  "sign-in",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type FieldChange = { field: string; from: unknown; to: unknown };

export type AuditEvent = {
  id: string;
  at: string;
  actor_id: string;
  actor_name: string;
  actor_email: string;
  project_id: string | null;
  entity_type: string;
  entity_id: string;
  entity_label: string;
  action: string;
  summary: string;
  /** Parsed from the stored JSON. */
  changes: FieldChange[];
};

export type AuditInput = {
  principal: Principal;
  projectId?: string | null;
  entityType: "task" | "risk" | "document" | "change_order" | "account";
  entityId: string;
  entityLabel?: string;
  action: AuditAction;
  summary?: string;
  changes?: FieldChange[];
};

/**
 * Fields that must never reach the log.
 *
 * A password hash in an audit row is a password hash in every backup of the
 * audit table, and the interesting fact — that the credential changed — is
 * carried by the action instead.
 */
const REDACTED = new Set(["password", "password_hash", "session_version"]);

/**
 * The changed fields between a stored row and a patch.
 *
 * Undefined values in the patch mean "not supplied" and are skipped; a field
 * whose new value equals the old one is not a change.
 */
export function diffFields(
  before: Record<string, unknown>,
  patch: Record<string, unknown>
): FieldChange[] {
  const changes: FieldChange[] = [];

  for (const [field, to] of Object.entries(patch)) {
    if (to === undefined) continue;
    if (REDACTED.has(field)) continue;

    const from = before[field] ?? null;
    const next = to ?? null;

    // Loose comparison on purpose: SQLite hands back 0/1 for booleans and the
    // patch carries true/false, and a strict check would report every save as
    // a change to every boolean on the row.
    if (from === next) continue;
    if (typeof from === "number" && typeof next === "boolean" && Boolean(from) === next) continue;
    if (typeof from === "boolean" && typeof next === "number" && from === Boolean(next)) continue;
    if (String(from) === String(next)) continue;

    changes.push({ field, from, to: next });
  }

  return changes;
}

/**
 * Writes one audit row.
 *
 * `db` should be the handle the caller's transaction is running on. Passing the
 * default is only right for a write that is a single statement.
 */
export function recordAudit(input: AuditInput, db: Database = getDb()): void {
  db.prepare(
    `INSERT INTO audit_events
       (id, actor_id, actor_name, actor_email, project_id, entity_type, entity_id,
        entity_label, action, summary, changes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `aud-${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    input.principal.id,
    input.principal.name,
    input.principal.email,
    input.projectId ?? null,
    input.entityType,
    input.entityId,
    input.entityLabel ?? "",
    input.action,
    input.summary ?? "",
    JSON.stringify(input.changes ?? [])
  );
}

function parse(rows: (Omit<AuditEvent, "changes"> & { changes: string })[]): AuditEvent[] {
  return rows.map((row) => {
    let changes: FieldChange[] = [];
    try {
      const parsed: unknown = JSON.parse(row.changes);
      if (Array.isArray(parsed)) changes = parsed as FieldChange[];
    } catch {
      // A row written by an older build, or hand-edited. The event still says
      // who and when, which is most of its value; show it without the diff.
    }
    return { ...row, changes };
  });
}

type Row = Omit<AuditEvent, "changes"> & { changes: string };

/** The history of one record — what the inspectors show. */
export function auditForEntity(entityType: string, entityId: string, limit = 25): AuditEvent[] {
  return parse(
    all<Row>(
      `SELECT * FROM audit_events
        WHERE entity_type = ? AND entity_id = ?
        ORDER BY at DESC, rowid DESC
        LIMIT ?`,
      [entityType, entityId, limit]
    )
  );
}

/** Everything that happened on one project. */
export function auditForProject(projectId: string, limit = 200): AuditEvent[] {
  return parse(
    all<Row>(
      `SELECT * FROM audit_events
        WHERE project_id = ?
        ORDER BY at DESC, rowid DESC
        LIMIT ?`,
      [projectId, limit]
    )
  );
}

/**
 * Account changes, which belong to no project.
 *
 * Kept separate from the project feed because the audience is different: a
 * planner should see who moved an activity on their project; only an
 * administrator should see who changed somebody's role.
 */
export function auditForAccounts(limit = 200): AuditEvent[] {
  return parse(
    all<Row>(
      `SELECT * FROM audit_events
        WHERE entity_type = 'account'
        ORDER BY at DESC, rowid DESC
        LIMIT ?`,
      [limit]
    )
  );
}
