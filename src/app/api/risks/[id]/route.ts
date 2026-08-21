import { NextResponse } from "next/server";
import { clientKey, consume, LIMITS, tooManyRequests } from "@/lib/rate-limit";
import { getDb, one } from "@/lib/db";
import { riskPatchSchema, toFieldErrors } from "@/lib/validation";
import type { Risk } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const risk = one<Risk>(`SELECT * FROM risks WHERE id = ?`, [id]);
  if (!risk) return NextResponse.json({ error: "Risk not found" }, { status: 404 });
  return NextResponse.json({ risk });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const gate = consume(clientKey(req, "write"), LIMITS.write);
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSeconds);
  if (!one<Risk>(`SELECT id FROM risks WHERE id = ?`, [id])) {
    return NextResponse.json({ error: "Risk not found" }, { status: 404 });
  }

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
  });

  write();

  return NextResponse.json({ risk: one<Risk>(`SELECT * FROM risks WHERE id = ?`, [id]) });
}
