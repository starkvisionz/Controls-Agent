/**
 * The one place a change order becomes a budget.
 *
 * The same discipline as `rollup-core.mjs`, one step further up the chain.
 * Where that module owns *progress -> earned value*, this one owns
 * *commercial position -> budget*:
 *
 *   change order approved (allocated to a control account)
 *     -> cost_accounts.approved_changes  (SUM of approved orders on that account)
 *     -> cost_accounts.current_budget    (original + approved)
 *     -> recalculateProject()            -> earned value, EAC, the EVM period
 *     -> projectMetrics(), and so every view and the agent briefing
 *
 * Nothing else may write `approved_changes` or `current_budget`. The register is
 * the record; the budget is derived from it. That is what makes approving an
 * order on the Changes page move CPI and the forecast at completion rather than
 * updating a table nobody's figures depend on — and why the seeder calls this
 * too, so the invariant holds from the first row inserted.
 *
 * Plain JavaScript so `scripts/seed.mjs` runs this exact code rather than a
 * second implementation of it.
 *
 * Schedule impact is deliberately absent from the chain. Starkvisionz stores the
 * network without solving it, so applying an approved order's days to the
 * forecast finish would assert an entitlement no critical path produced. The
 * days are reported on the page as an unapplied total instead.
 */
import { recalculateProject } from "./rollup-core.mjs";

/** Only an approved order changes a budget; the rest are exposure, not money. */
export const APPROVED = "approved";

/**
 * Re-derives every control account's approved changes and current budget from
 * the change-order register, then re-runs the earned-value roll-up on top.
 *
 * Runs as one transaction: no reader sees a budget that has moved without the
 * earned value and forecast that follow from it.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} projectId
 */
export function applyChangeOrders(db, projectId) {
  const apply = db.transaction(() => {
    // Reset first. An order that was approved and is now rejected, or moved to
    // another account, has to stop counting against the account it left —
    // adding deltas would leave that money stranded.
    db.prepare(
      `UPDATE cost_accounts
          SET approved_changes = 0,
              current_budget   = original_budget
        WHERE project_id = ?`
    ).run(projectId);

    // An approved order with no allocation cannot land anywhere. The API
    // refuses to approve one, so this is a floor rather than a policy: a row
    // edited around the API is left out of the budget instead of silently
    // spread across accounts it was never priced against.
    db.prepare(
      `UPDATE cost_accounts
          SET approved_changes = COALESCE((
                SELECT SUM(co.cost_impact)
                  FROM change_orders co
                 WHERE co.cost_account_id = cost_accounts.id
                   AND co.status = ?
              ), 0)
        WHERE project_id = ?`
    ).run(APPROVED, projectId);

    db.prepare(
      `UPDATE cost_accounts
          SET current_budget = original_budget + approved_changes
        WHERE project_id = ?`
    ).run(projectId);

    // Budgets moved, so earned value, CPI-based EAC and the current EVM period
    // are all stale until this runs.
    recalculateProject(db, projectId);
  });

  apply();
}

/**
 * The commercial position, for the page header and the agent briefing.
 *
 * Pending is deliberately separate from approved: a trend is exposure the
 * project carries, not money it has. Reporting them as one number is how a
 * forecast quietly absorbs a claim nobody has agreed to pay.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} projectId
 */
export function changeOrderSummary(db, projectId) {
  const rows = db
    .prepare(
      `SELECT status,
              COUNT(*)                          AS count,
              COALESCE(SUM(cost_impact), 0)     AS value,
              COALESCE(SUM(schedule_impact_days), 0) AS days
         FROM change_orders
        WHERE project_id = ?
        GROUP BY status`
    )
    .all(projectId);

  const by = (status) => rows.find((r) => r.status === status) ?? { count: 0, value: 0, days: 0 };

  const trend = by("trend");
  const submitted = by("submitted");
  const approved = by(APPROVED);
  const rejected = by("rejected");

  const budgets = db
    .prepare(
      `SELECT COALESCE(SUM(original_budget), 0) AS original,
              COALESCE(SUM(current_budget), 0)  AS current
         FROM cost_accounts WHERE project_id = ?`
    )
    .get(projectId);

  // Approved value that never reached a budget, because the row carries no
  // allocation. Should be zero; surfaced rather than hidden if it is not.
  const unallocated = db
    .prepare(
      `SELECT COALESCE(SUM(cost_impact), 0) AS value
         FROM change_orders
        WHERE project_id = ? AND status = ? AND cost_account_id IS NULL`
    )
    .get(projectId, APPROVED);

  return {
    trend,
    submitted,
    approved,
    rejected,
    /** Everything still open — the exposure the forecast does not yet carry. */
    pending: {
      count: trend.count + submitted.count,
      value: trend.value + submitted.value,
      days: trend.days + submitted.days,
    },
    originalBudget: budgets.original,
    currentBudget: budgets.current,
    unallocatedApproved: unallocated.value,
    /** Recorded on approved orders, and not applied to any forecast date. */
    approvedDays: approved.days,
  };
}

/** Days from raised to decided, for the orders that have been decided. */
export function decisionCycleDays(db, projectId) {
  const rows = db
    .prepare(
      `SELECT CAST(julianday(decision_date) - julianday(raised_date) AS INTEGER) AS days
         FROM change_orders
        WHERE project_id = ? AND decision_date IS NOT NULL AND status IN (?, 'rejected')
        ORDER BY days`
    )
    .all(projectId, APPROVED)
    .map((r) => r.days)
    .filter((d) => Number.isFinite(d) && d >= 0);

  if (rows.length === 0) return { count: 0, median: null, longest: null };

  // Median, not mean: one order that sat with the client for a year should not
  // make the typical turnaround look worse than it is.
  const middle = Math.floor(rows.length / 2);
  const median =
    rows.length % 2 === 0 ? Math.round((rows[middle - 1] + rows[middle]) / 2) : rows[middle];

  return { count: rows.length, median, longest: rows[rows.length - 1] };
}
