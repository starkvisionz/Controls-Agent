import { NextResponse } from "next/server";
import { requireProjectRead } from "@/lib/guard";
import { getProject, listRisks, listWbs, riskSummary } from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const guard = requireProjectRead(req, id);
  if (!guard.ok) return guard.response;

  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  return NextResponse.json({
    project,
    risks: listRisks(project.id),
    summary: riskSummary(project.id),
    wbs: listWbs(project.id),
  });
}
