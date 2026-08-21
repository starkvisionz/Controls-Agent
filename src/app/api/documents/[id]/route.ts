import { NextResponse } from "next/server";
import { one, run } from "@/lib/db";
import type { ProjectDocument } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EDITABLE = new Set([
  "status",
  "review_status",
  "revision",
  "reviewer",
  "due_date",
  "issued_date",
  "returned_date",
  "notes",
]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const doc = one<ProjectDocument>(`SELECT * FROM documents WHERE id = ?`, [id]);
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });
  return NextResponse.json({ document: doc });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!one<ProjectDocument>(`SELECT * FROM documents WHERE id = ?`, [id])) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const body = (await req.json()) as Record<string, unknown>;
  const updates = Object.entries(body).filter(([key]) => EDITABLE.has(key));
  if (updates.length === 0) {
    return NextResponse.json({ error: "No editable fields supplied" }, { status: 400 });
  }

  run(
    `UPDATE documents SET ${updates.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`,
    [...updates.map(([, v]) => v), id]
  );

  return NextResponse.json({
    document: one<ProjectDocument>(`SELECT * FROM documents WHERE id = ?`, [id]),
  });
}
