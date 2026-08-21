import { NextResponse } from "next/server";
import { one, run } from "@/lib/db";
import type { Task } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fields a user may edit from the schedule view. */
const EDITABLE = new Set([
  "status",
  "percent_complete",
  "forecast_start",
  "forecast_finish",
  "responsible",
  "notes",
  "total_float_days",
]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = one<Task>(`SELECT * FROM tasks WHERE id = ?`, [id]);
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  return NextResponse.json({ task });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const existing = one<Task>(`SELECT * FROM tasks WHERE id = ?`, [id]);
  if (!existing) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  const body = (await req.json()) as Record<string, unknown>;
  const updates = Object.entries(body).filter(([key]) => EDITABLE.has(key));
  if (updates.length === 0) {
    return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
  }

  const setClause = updates.map(([key]) => `${key} = ?`).join(", ");
  run(`UPDATE tasks SET ${setClause} WHERE id = ?`, [...updates.map(([, v]) => v), id]);

  // Progress and earned value move together, so recompute EV from the budget.
  if (Object.hasOwn(body, "percent_complete")) {
    run(`UPDATE tasks SET earned_value = budget * (percent_complete / 100.0) WHERE id = ?`, [id]);
  }

  return NextResponse.json({ task: one<Task>(`SELECT * FROM tasks WHERE id = ?`, [id]) });
}
