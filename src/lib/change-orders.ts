import type { Database } from "better-sqlite3";
import { getDb, one } from "@/lib/db";
// Plain JS so the seeder runs this exact chain rather than a second copy of it.
import {
  applyChangeOrders as core,
  changeOrderSummary as coreSummary,
  decisionCycleDays as coreCycle,
} from "@/lib/change-orders-core.mjs";

/** One status bucket of the register. */
export type ChangeBucket = { count: number; value: number; days: number };

export type ChangeOrderSummary = {
  trend: ChangeBucket;
  submitted: ChangeBucket;
  approved: ChangeBucket;
  rejected: ChangeBucket;
  pending: ChangeBucket;
  originalBudget: number;
  currentBudget: number;
  unallocatedApproved: number;
  approvedDays: number;
};

export type DecisionCycle = { count: number; median: number | null; longest: number | null };

/**
 * Re-derives control-account budgets from the change-order register and re-runs
 * the earned-value roll-up. See `change-orders-core.mjs` for the chain.
 */
export function applyChangeOrders(projectId: string, db: Database = getDb()): void {
  core(db, projectId);
}

export function changeOrderSummary(projectId: string, db: Database = getDb()): ChangeOrderSummary {
  return coreSummary(db, projectId) as ChangeOrderSummary;
}

export function decisionCycleDays(projectId: string, db: Database = getDb()): DecisionCycle {
  return coreCycle(db, projectId) as DecisionCycle;
}

/**
 * Guards an allocation: the account named must belong to the project the order
 * is on.
 *
 * Without this, a caller authorised on one project could aim an order at
 * another project's control account and move a budget they hold no role on —
 * the project scoping would be intact on the URL and bypassed on the body.
 */
export function accountBelongsTo(
  accountId: string | null | undefined,
  projectId: string
): { field: string; message: string } | null {
  if (!accountId) return null;

  const row = one<{ project_id: string }>(`SELECT project_id FROM cost_accounts WHERE id = ?`, [
    accountId,
  ]);

  if (!row || row.project_id !== projectId) {
    return { field: "cost_account_id", message: "is not a control account on this project" };
  }
  return null;
}
