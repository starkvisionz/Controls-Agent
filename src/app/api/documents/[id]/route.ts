import { NextResponse } from "next/server";
import { checkRate, tooManyRequests } from "@/lib/rate-limit";
import { getDb, one } from "@/lib/db";
import { documentPatchSchema, toFieldErrors } from "@/lib/validation";
import type { ProjectDocument } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const doc = one<ProjectDocument>(`SELECT * FROM documents WHERE id = ?`, [id]);
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  return NextResponse.json({ document: doc });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const gate = checkRate(req, "write");
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSeconds);
  const existing = one<ProjectDocument>(`SELECT * FROM documents WHERE id = ?`, [id]);
  if (!existing) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = documentPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid document update", fields: toFieldErrors(parsed.error) },
      { status: 422 }
    );
  }
  const patch = parsed.data;

  // A review cannot come back before it went out.
  const issued = patch.issued_date !== undefined ? patch.issued_date : existing.issued_date;
  const returned = patch.returned_date !== undefined ? patch.returned_date : existing.returned_date;
  if (issued && returned && returned < issued) {
    return NextResponse.json(
      {
        error: "Invalid document update",
        fields: [{ field: "returned_date", message: "a document cannot return before it is issued" }],
      },
      { status: 422 }
    );
  }

  const entries = Object.entries(patch);
  getDb()
    .prepare(`UPDATE documents SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`)
    .run(...entries.map(([, v]) => v as never), id);

  return NextResponse.json({
    document: one<ProjectDocument>(`SELECT * FROM documents WHERE id = ?`, [id]),
  });
}
