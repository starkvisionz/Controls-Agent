import { NextResponse } from "next/server";
import { requireProjectRead } from "@/lib/guard";
import {
  documentSummary,
  getProject,
  listChangeOrders,
  listCriticalTasks,
  listEvmPeriods,
  listMilestones,
  listCostAccounts,
  listSlippedTasks,
  projectMetrics,
  riskSummary,
} from "@/lib/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Everything the dashboard needs in one round trip. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const guard = requireProjectRead(req, id);
  if (!guard.ok) return guard.response;

  const project = getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json({
    project,
    metrics: projectMetrics(project),
    evm: listEvmPeriods(project.id),
    costAccounts: listCostAccounts(project.id),
    milestones: listMilestones(project.id),
    criticalTasks: listCriticalTasks(project.id, 8),
    slippedTasks: listSlippedTasks(project.id, 6),
    changeOrders: listChangeOrders(project.id),
    risks: riskSummary(project.id),
    documents: documentSummary(project.id, project.data_date),
  });
}
