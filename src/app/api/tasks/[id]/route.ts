import { NextResponse } from "next/server";
import { requirePermission, requireProjectRead } from "@/lib/guard";
import { checkRate, tooManyRequests } from "@/lib/rate-limit";
import { getDb, one } from "@/lib/db";
import { recalculateProject } from "@/lib/rollup";
import { taskPatchSchema, toFieldErrors } from "@/lib/validation";
import type { Task } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = one<Task>(`SELECT * FROM tasks WHERE id = ?`, [id]);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  // Authorised against the project the row belongs to. Reading a row by id
  // would otherwise sidestep project scoping entirely.
  const guard = requireProjectRead(req, task.project_id);
  if (!guard.ok) return guard.response;

  return NextResponse.json({ task });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const existing = one<Task>(`SELECT * FROM tasks WHERE id = ?`, [id]);
  if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const guard = requirePermission(req, "schedule:write", existing.project_id);
  if (!guard.ok) return guard.response;

  const gate = checkRate(req, "write", { identity: guard.principal.id });
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSeconds);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = taskPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid activity update", fields: toFieldErrors(parsed.error) },
      { status: 422 }
    );
  }
  const patch = parsed.data;

  // Cross-field rules need the stored row too: a caller may move only one end
  // of the window and still invert it against the value already on record.
  const start = patch.forecast_start ?? existing.forecast_start;
  const finish = patch.forecast_finish ?? existing.forecast_finish;
  if (finish < start) {
    return NextResponse.json(
      {
        error: "Invalid activity update",
        fields: [
          { field: "forecast_finish", message: "forecast finish cannot precede forecast start" },
        ],
      },
      { status: 422 }
    );
  }

  const db = getDb();
  const entries = Object.entries(patch);

  const write = db.transaction(() => {
    db.prepare(
      `UPDATE tasks SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`
    ).run(...entries.map(([, v]) => v as never), id);

    // Status and progress are two views of one fact; keep them consistent even
    // when only one of them was sent.
    if (patch.status === "complete" && patch.percent_complete === undefined) {
      db.prepare(`UPDATE tasks SET percent_complete = 100 WHERE id = ?`).run(id);
    } else if (patch.status === "not-started" && patch.percent_complete === undefined) {
      db.prepare(`UPDATE tasks SET percent_complete = 0 WHERE id = ?`).run(id);
    }

    // Activity earned value is always derived, never supplied.
    db.prepare(
      `UPDATE tasks SET earned_value = budget * (percent_complete / 100.0) WHERE id = ?`
    ).run(id);

    // The write is not finished until the money agrees with the schedule.
    recalculateProject(existing.project_id, db);
  });

  write();

  return NextResponse.json({ task: one<Task>(`SELECT * FROM tasks WHERE id = ?`, [id]) });
}
