import { NextResponse } from "next/server";
import { requirePermission, requireProjectRead } from "@/lib/guard";
import { diffFields, recordAudit } from "@/lib/audit";
import { checkRate, tooManyRequests } from "@/lib/rate-limit";
import { getDb, one } from "@/lib/db";
import { riskPatchSchema, toFieldErrors } from "@/lib/validation";
import type { Risk } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const risk = one<Risk>(`SELECT * FROM risks WHERE id = ?`, [id]);
  if (!risk) return NextResponse.json({ error: "Risk not found" }, { status: 404 });

  const guard = requireProjectRead(req, risk.project_id);
  if (!guard.ok) return guard.response;

  return NextResponse.json({ risk });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // The whole row, not just the id: the audit diff is computed against it.
  const existing = one<Risk>(`SELECT * FROM risks WHERE id = ?`, [id]);
  if (!existing) return NextResponse.json({ error: "Risk not found" }, { status: 404 });

  const guard = requirePermission(req, "risk:write", existing.project_id);
  if (!guard.ok) return guard.response;

  const gate = checkRate(req, "write", { identity: guard.principal.id });
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSeconds);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = riskPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid risk update", fields: toFieldErrors(parsed.error) },
      { status: 422 }
    );
  }

  const db = getDb();
  const entries = Object.entries(parsed.data);
  const changes = diffFields(existing as unknown as Record<string, unknown>, parsed.data);

  const write = db.transaction(() => {
    db.prepare(
      `UPDATE risks SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`
    ).run(...entries.map(([, v]) => v as never), id);

    // Severity and exposure are derived from the score — never accepted from
    // the client, so they cannot be set to something the score contradicts.
    db.prepare(
      `UPDATE risks
          SET severity = probability * impact,
              expected_value = CASE WHEN status = 'closed' THEN 0
                                    ELSE cost_impact * (probability / 5.0) END
        WHERE id = ?`
    ).run(id);

    recordAudit(
      {
        principal: guard.principal,
        projectId: existing.project_id,
        entityType: "risk",
        entityId: id,
        entityLabel: existing.code,
        action: "update",
        summary: existing.title,
        changes,
      },
      db
    );
  });

  write();

  return NextResponse.json({ risk: one<Risk>(`SELECT * FROM risks WHERE id = ?`, [id]) });
}
