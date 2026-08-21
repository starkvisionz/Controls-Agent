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
import { getChangeOrder, getProject, listChangeOrders, projectMetrics } from "@/lib/queries";
import { changeOrderPatchSchema, changeOrderRules, toFieldErrors } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const order = getChangeOrder(id);
  if (!order) return NextResponse.json({ error: "Change order not found" }, { status: 404 });

  // Authorised against the project the row belongs to, not the URL it arrived on.
  const guard = requireProjectRead(req, order.project_id);
  if (!guard.ok) return guard.response;

  return NextResponse.json({ changeOrder: order });
}

/**
 * Amending an order — including approving it.
 *
 * Approval is the act that moves a budget, so the whole write runs through
 * `applyChangeOrders`: the register is updated, control-account budgets are
 * re-derived from it, and the earned-value roll-up follows, all in one
 * transaction. The response carries the project's metrics afterwards, because
 * the number the caller most wants to see is the one that just changed.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const existing = getChangeOrder(id);
  if (!existing) return NextResponse.json({ error: "Change order not found" }, { status: 404 });

  // Change orders are the project's commercial position, which is the cost
  // lead's to move; the same permission that governs the cost view.
  const guard = requirePermission(req, "cost:write", existing.project_id);
  if (!guard.ok) return guard.response;

  const gate = checkRate(req, "write", { identity: guard.principal.id });
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSeconds);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = changeOrderPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid change order update", fields: toFieldErrors(parsed.error) },
      { status: 422 }
    );
  }
  const patch = parsed.data;

  const allocation =
    patch.cost_account_id !== undefined ? patch.cost_account_id ?? null : existing.cost_account_id;

  const accountError = accountBelongsTo(allocation, existing.project_id);
  if (accountError) {
    return NextResponse.json(
      { error: "Invalid change order update", fields: [accountError] },
      { status: 422 }
    );
  }

  // The cross-field rules read the row as it would be after the patch: a caller
  // may send only a status and still invert something against what is stored.
  const merged = {
    status: patch.status ?? existing.status,
    cost_account_id: allocation,
    cost_impact: patch.cost_impact ?? existing.cost_impact,
    raised_date: existing.raised_date,
    submitted_date:
      patch.submitted_date !== undefined ? patch.submitted_date ?? null : existing.submitted_date,
    decision_date:
      patch.decision_date !== undefined ? patch.decision_date ?? null : existing.decision_date,
  };

  const ruleErrors = changeOrderRules(merged);
  if (ruleErrors.length > 0) {
    return NextResponse.json(
      { error: "Invalid change order update", fields: ruleErrors },
      { status: 422 }
    );
  }

  const db = getDb();
  const entries = Object.entries(patch);

  const write = db.transaction(() => {
    if (entries.length > 0) {
      db.prepare(
        `UPDATE change_orders SET ${entries.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`
      ).run(...entries.map(([, v]) => (v === undefined ? null : (v as never))), id);
    }

    // The write is not finished until the budgets agree with the register.
    applyChangeOrders(existing.project_id, db);
  });

  write();

  const project = getProject(existing.project_id);

  return NextResponse.json({
    changeOrder: getChangeOrder(id),
    changeOrders: listChangeOrders(existing.project_id),
    summary: changeOrderSummary(existing.project_id),
    cycle: decisionCycleDays(existing.project_id),
    metrics: project ? projectMetrics(project) : null,
  });
}
