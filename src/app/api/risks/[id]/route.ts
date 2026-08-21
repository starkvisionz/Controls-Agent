import { NextResponse } from "next/server";
import { one, run } from "@/lib/db";
import type { Risk } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE = new Set([
  "status",
  "probability",
  "impact",
  "owner",
  "response_strategy",
  "mitigation_plan",
  "mitigation_progress",
  "cost_impact",
  "schedule_impact_days",
  "review_date",
  "residual_probability",
  "residual_impact",
]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const risk = one<Risk>(`SELECT * FROM risks WHERE id = ?`, [id]);
  if (!risk) return NextResponse.json({ error: "Risk not found" }, { status: 404 });
  return NextResponse.json({ risk });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!one<Risk>(`SELECT * FROM risks WHERE id = ?`, [id])) {
    return NextResponse.json({ error: "Risk not found" }, { status: 404 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const updates = Object.entries(body).filter(([key]) => EDITABLE.has(key));
  if (updates.length === 0) {
    return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
  }

  run(
    `UPDATE risks SET ${updates.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
    [...updates.map(([, v]) => v), id]
  );

  // Severity and expected value are derived — never trust them from the client.
  run(
    `UPDATE risks
        SET severity = probability * impact,
            expected_value = CASE WHEN status = 'closed' THEN 0
                                  ELSE cost_impact * (probability / 5.0) END
      WHERE id = ?`,
    [id]
  );

  return NextResponse.json({ risk: one<Risk>(`SELECT * FROM risks WHERE id = ?`, [id]) });
}
