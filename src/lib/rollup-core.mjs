/**
 * The one place progress becomes money.
 *
 * Physical progress is owned by the schedule; budgets are owned by the cost
 * breakdown. This module joins them in the direction real earned-value
 * management does:
 *
 *   activity % complete
 *     -> budget-weighted progress of the WBS node
 *     -> control-account earned value (node progress x account budget)
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
        `SELECT id, wbs_id, current_budget, actual_cost
           FROM cost_accounts WHERE project_id = ?`
      )
      .all(projectId);

    const setAccount = db.prepare(
      `UPDATE cost_accounts
          SET earned_value = ?, forecast_at_completion = ?
        WHERE id = ?`
    );

    for (const account of accounts) {
      const node = account.wbs_id ? progress.get(account.wbs_id) : undefined;

      // An account whose WBS branch holds no budgeted activity has no schedule
      // to earn against; leave it at zero rather than inventing progress.
      const fraction = node && node.budget > 0 ? node.earned / node.budget : 0;
      const earned = account.current_budget * fraction;

      // CPI-based EAC, the convention projectMetrics() reports. Before any cost
      // is booked there is no performance signal, so the budget stands.
      const cpi = account.actual_cost > 0 ? earned / account.actual_cost : 0;
      const eac = cpi > 0 ? account.current_budget / cpi : account.current_budget;

      setAccount.run(Math.round(earned), Math.round(eac), account.id);
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
