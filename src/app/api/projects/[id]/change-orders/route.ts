import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requirePermission, requireProjectRead } from "@/lib/guard";
import { checkRate, tooManyRequests } from "@/lib/rate-limit";
import {
  accountBelongsTo,
  applyChangeOrders,
  changeOrderSummary,
  decisionCycleDays,
} from "@/lib/change-orders";
import {
  getProject,
  listChangeOrders,
  listCostAccounts,
  nextChangeOrderCode,
  projectMetrics,
} from "@/lib/queries";
import { changeOrderCreateSchema, changeOrderRules, toFieldErrors } from "@/lib/validation";

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
    changeOrders: listChangeOrders(project.id),
    summary: changeOrderSummary(project.id),
    cycle: decisionCycleDays(project.id),
    // The allocation target list — an order has to name one before approval.
    accounts: listCostAccounts(project.id).map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      category: a.category,
      current_budget: a.current_budget,
    })),
    nextCode: nextChangeOrderCode(project.id),
  });
}

/** Raising a trend. New orders start open, so this moves no budget. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const guard = requirePermission(req, "cost:write", id);
  if (!guard.ok) return guard.response;

  const gate = checkRate(req, "write", { identity: guard.principal.id });
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSeconds);

  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = changeOrderCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid change order", fields: toFieldErrors(parsed.error) },
      { status: 422 }
    );
  }
  const input = parsed.data;

  // An allocation must belong to THIS project. Without the check, a caller who
  // can write one project could aim an order at another project's budget.
  const accountError = accountBelongsTo(input.cost_account_id ?? null, project.id);
  if (accountError) {
    return NextResponse.json(
      { error: "Invalid change order", fields: [accountError] },
      { status: 422 }
    );
  }

  const ruleErrors = changeOrderRules({
    status: input.status,
    cost_account_id: input.cost_account_id ?? null,
    cost_impact: input.cost_impact ?? 0,
    raised_date: input.raised_date,
    submitted_date: input.submitted_date ?? null,
    decision_date: null,
  });
  if (ruleErrors.length > 0) {
    return NextResponse.json(
      { error: "Invalid change order", fields: ruleErrors },
      { status: 422 }
    );
  }

  const db = getDb();
  const orderId = `co-${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  db.prepare(
    `INSERT INTO change_orders (id, project_id, cost_account_id, code, client_ref, title, origin,
       status, cost_impact, schedule_impact_days, raised_date, submitted_date, decision_date,
       owner, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
  ).run(
    orderId,
    project.id,
    input.cost_account_id ?? null,
    nextChangeOrderCode(project.id),
    input.client_ref ?? "",
    input.title,
    input.origin,
    input.status,
    input.cost_impact ?? 0,
    input.schedule_impact_days ?? 0,
    input.raised_date,
    input.submitted_date ?? null,
    input.owner ?? "",
    input.description ?? ""
  );

  // A new order is open, so it changes no budget — but running the chain keeps
  // one path to the figures rather than a second one that "knows" it needn't.
  applyChangeOrders(project.id);

  return NextResponse.json(
    {
      changeOrders: listChangeOrders(project.id),
      summary: changeOrderSummary(project.id),
    },
    { status: 201 }
  );
}
