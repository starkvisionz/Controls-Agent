/**
 * The one place progress becomes money.
 *
 * Physical progress is owned by the schedule; budgets are owned by the cost
 * breakdown. This module joins them in the direction real earned-value
 * management does:
 *
 *   activity % complete
 *     -> budget-weighted progress of the WBS node
 *     -> control-account earned value (node progress x ORIGINAL budget,
 *        plus progress recorded on approved change scope)
 *     -> forecast at completion (budget / CPI)
 *     -> the EVM period sitting at the data date
 *     -> projectMetrics(), and therefore every view and the agent briefing
 *
 * Nothing else may write `cost_accounts.earned_value` or the current period's
 * roll-up. The seeder calls this too — through this same file, not a copy — so
 * the invariant holds from the first row inserted rather than only after the
 * first edit.
 *
 * Actual cost is deliberately NOT derived from progress: it comes from the
 * ledger and changes only through cost transactions.
 *
 * Plain JavaScript so the TypeScript app and the Node seed script can share one
 * implementation instead of maintaining two that drift.
 */

/**
 * Earned value on approved change scope, by control account.
 *
 * A change order is a package of work with its own progress. Approving one adds
 * its value to the budget immediately — the commitment is real the moment it is
 * agreed — but none of it is earned until the work is done, so an order sits at
 * 0% until somebody records progress against it.
 *
 * Only approved orders count. A trend is exposure the project carries, not
 * scope it has been told to build.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} projectId
 * @returns {Map<string, number>} account id -> earned value on change scope
 */
function earnedOnChanges(db, projectId) {
  const rows = db
    .prepare(
      `SELECT cost_account_id AS accountId,
              COALESCE(SUM(cost_impact * percent_complete / 100.0), 0) AS earned
         FROM change_orders
        WHERE project_id = ? AND status = 'approved' AND cost_account_id IS NOT NULL
        GROUP BY cost_account_id`
    )
    .all(projectId);

  return new Map(rows.map((r) => [r.accountId, r.earned]));
}

/**
 * Budget-weighted percent complete for every WBS node, from its activities and
 * propagated up to ancestors. Milestones carry no budget, so a zero-budget
 * marker can never move a control account.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} projectId
 * @returns {Map<string, { budget: number, earned: number }>}
 */
function nodeProgress(db, projectId) {
  const rows = db
    .prepare(
      `SELECT wbs_id,
              COALESCE(SUM(budget), 0) AS budget,
              COALESCE(SUM(budget * percent_complete / 100.0), 0) AS earned
         FROM tasks
        WHERE project_id = ? AND is_milestone = 0
        GROUP BY wbs_id`
    )
    .all(projectId);

  const direct = new Map();
  for (const row of rows) direct.set(row.wbs_id, { budget: row.budget, earned: row.earned });

  const nodes = db
    .prepare(`SELECT id, parent_id FROM wbs_nodes WHERE project_id = ?`)
    .all(projectId);

  const childrenOf = new Map();
  for (const node of nodes) {
    if (!node.parent_id) continue;
    childrenOf.set(node.parent_id, [...(childrenOf.get(node.parent_id) ?? []), node.id]);
  }

  // Roll leaf totals up the tree so an account attached to a parent node still
  // sees work booked against its children.
  const totals = new Map();
  const visit = (id) => {
    const cached = totals.get(id);
    if (cached) return cached;

    const own = direct.get(id) ?? { budget: 0, earned: 0 };
    let budget = own.budget;
    let earned = own.earned;
    for (const child of childrenOf.get(id) ?? []) {
      const sub = visit(child);
      budget += sub.budget;
      earned += sub.earned;
    }

    const total = { budget, earned };
    totals.set(id, total);
    return total;
  };

  for (const node of nodes) visit(node.id);
  return totals;
}

/**
 * Recomputes control-account earned value and forecast, then the EVM period at
 * the data date, from current activity progress. Runs in one transaction so no
 * reader observes a half-updated roll-up.
 *
 * @param {import("better-sqlite3").Database} db
 * @param {string} projectId
 */
export function recalculateProject(db, projectId) {
  const apply = db.transaction(() => {
    const progress = nodeProgress(db, projectId);

    const accounts = db
      .prepare(
        `SELECT id, wbs_id, original_budget, current_budget, baseline_planned_value, actual_cost
           FROM cost_accounts WHERE project_id = ?`
      )
      .all(projectId);

    // Progress on approved change scope, which is earned on its own record
    // rather than on the baseline schedule's. See changeEarned() below.
    const changeEarned = earnedOnChanges(db, projectId);

    const setAccount = db.prepare(
      `UPDATE cost_accounts
          SET earned_value = ?, planned_value = ?, forecast_at_completion = ?
        WHERE id = ?`
    );

    for (const account of accounts) {
      const node = account.wbs_id ? progress.get(account.wbs_id) : undefined;

      // An account whose WBS branch holds no budgeted activity has no schedule
      // to earn against; leave it at zero rather than inventing progress.
      const fraction = node && node.budget > 0 ? node.earned / node.budget : 0;

      // The baseline scope earns against the ORIGINAL budget, not the current
      // one. Earning the current budget at the schedule's fraction is what made
      // approving a change order raise earned value on the spot: the same
      // physical progress, applied to a bigger number, reads as work performed
      // that nobody performed.
      const baselineEarned = account.original_budget * fraction;
      const change = changeEarned.get(account.id) ?? 0;
      const earned = baselineEarned + change;

      // Change scope enters planned value on the same profile it is earned on,
      // which leaves SPI untouched by it. That is deliberate: until a change's
      // activities are baselined into the schedule there is no plan for them to
      // be measured against, and inventing one would move SPI on a commercial
      // event rather than a schedule one.
      const planned = account.baseline_planned_value + change;

      // CPI-based EAC, the convention projectMetrics() reports. Before any cost
      // is booked there is no performance signal, so the budget stands.
      const cpi = account.actual_cost > 0 ? earned / account.actual_cost : 0;
      const eac = cpi > 0 ? account.current_budget / cpi : account.current_budget;

      setAccount.run(Math.round(earned), Math.round(planned), Math.round(eac), account.id);
    }

    // Keep the S-curve's live tip on the same numbers as the KPI row.
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(earned_value), 0) AS ev,
                COALESCE(SUM(actual_cost), 0)  AS ac
           FROM cost_accounts WHERE project_id = ?`
      )
      .get(projectId);

    const project = db.prepare(`SELECT data_date FROM projects WHERE id = ?`).get(projectId);

    if (project?.data_date) {
      db.prepare(
        `UPDATE evm_periods
            SET earned_value = ?, actual_cost = ?
          WHERE project_id = ?
            AND is_forecast = 0
            AND period_end = (
              SELECT MAX(period_end) FROM evm_periods
               WHERE project_id = ? AND is_forecast = 0 AND period_end <= ?
            )`
      ).run(
        Math.round(totals.ev),
        Math.round(totals.ac),
        projectId,
        projectId,
        project.data_date
      );
    }
  });

  apply();
}
