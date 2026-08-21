import { NextResponse } from "next/server";
import { documentSummary, getProject, listDocuments, listWbs } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  return NextResponse.json({
    project,
    documents: listDocuments(project.id),
    summary: documentSummary(project.id, project.data_date),
    wbs: listWbs(project.id),
  });
}
