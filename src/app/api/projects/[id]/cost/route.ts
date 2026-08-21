import { NextResponse } from "next/server";
import { requireProjectRead } from "@/lib/guard";
import {
  getProject,
  listChangeOrders,
  listCostAccounts,
  listCostEntries,
  listEvmPeriods,
  listWbs,
  projectMetrics,
} from "@/lib/queries";

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
    metrics: projectMetrics(project),
    accounts: listCostAccounts(project.id),
    entries: listCostEntries(project.id, 300),
    evm: listEvmPeriods(project.id),
    changeOrders: listChangeOrders(project.id),
    wbs: listWbs(project.id),
  });
}
