import { all, one, run } from "@/lib/db";
import type {
  ChangeOrder,
  ChatMessage,
  CostAccount,
  CostEntry,
  DocumentSummary,
  EvmPeriod,
  Project,
  ProjectDocument,
  ProjectMetrics,
  Risk,
  RiskSummary,
  Task,
  WbsNode,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function listProjects(): Project[] {
  // Active work first, then largest contract first — the portfolio switcher
  // should open on the job that carries the most exposure.
  return all<Project>(
    `SELECT * FROM projects
      ORDER BY (status = 'active') DESC, contract_value DESC, code`
  );
}

export function getProject(id: string): Project | undefined {
  return one<Project>(`SELECT * FROM projects WHERE id = ? OR code = ?`, [id, id]);
}

/** The project the shell opens on: first active project, else first project. */
export function getDefaultProject(): Project | undefined {
  return listProjects()[0];
}

// ---------------------------------------------------------------------------
// WBS + schedule
// ---------------------------------------------------------------------------

export function listWbs(projectId: string): WbsNode[] {
  return all<WbsNode>(
    `SELECT * FROM wbs_nodes WHERE project_id = ? ORDER BY sort_order, code`,
    [projectId]
  );
}

export function listTasks(projectId: string): Task[] {
  return all<Task>(
    `SELECT * FROM tasks WHERE project_id = ? ORDER BY sort_order, code`,
    [projectId]
  );
}

export function getTask(id: string): Task | undefined {
  return one<Task>(`SELECT * FROM tasks WHERE id = ?`, [id]);
}

export function listCriticalTasks(projectId: string, limit = 10): Task[] {
  return all<Task>(
    `SELECT * FROM tasks
      WHERE project_id = ? AND is_critical = 1 AND status != 'complete'
      ORDER BY total_float_days ASC, forecast_finish ASC
      LIMIT ?`,
    [projectId, limit]
  );
}

export function listMilestones(projectId: string): Task[] {
  return all<Task>(
    `SELECT * FROM tasks WHERE project_id = ? AND is_milestone = 1
      ORDER BY forecast_finish`,
    [projectId]
  );
}

/** Activities forecast to finish later than their baseline. */
export function listSlippedTasks(projectId: string, limit = 8): Task[] {
  return all<Task>(
    `SELECT * FROM tasks
      WHERE project_id = ? AND status != 'complete'
        AND julianday(forecast_finish) > julianday(baseline_finish)
      ORDER BY (julianday(forecast_finish) - julianday(baseline_finish)) DESC
      LIMIT ?`,
    [projectId, limit]
  );
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export function listCostAccounts(projectId: string): CostAccount[] {
  return all<CostAccount>(
    `SELECT * FROM cost_accounts WHERE project_id = ? ORDER BY code`,
    [projectId]
  );
}

export function listCostEntries(projectId: string, limit = 200): CostEntry[] {
  return all<CostEntry>(
    `SELECT * FROM cost_entries WHERE project_id = ?
      ORDER BY entry_date DESC LIMIT ?`,
    [projectId, limit]
  );
}

export function listEvmPeriods(projectId: string): EvmPeriod[] {
  return all<EvmPeriod>(
    `SELECT * FROM evm_periods WHERE project_id = ? ORDER BY period_end`,
    [projectId]
  );
}

export function listChangeOrders(projectId: string): ChangeOrder[] {
  return all<ChangeOrder>(
    `SELECT * FROM change_orders WHERE project_id = ? ORDER BY raised_date DESC`,
    [projectId]
  );
}

// ---------------------------------------------------------------------------
// Risk
// ---------------------------------------------------------------------------

export function listRisks(projectId: string): Risk[] {
  return all<Risk>(
    `SELECT * FROM risks WHERE project_id = ? ORDER BY severity DESC, code`,
    [projectId]
  );
}

export function getRisk(id: string): Risk | undefined {
  return one<Risk>(`SELECT * FROM risks WHERE id = ?`, [id]);
}

export function riskSummary(projectId: string): RiskSummary {
  const risks = listRisks(projectId);
  const open = risks.filter((r) => r.status !== "closed");
  const byCategory = new Map<string, { count: number; exposure: number }>();
  for (const r of open) {
    const entry = byCategory.get(r.category) ?? { count: 0, exposure: 0 };
    entry.count += 1;
    entry.exposure += r.expected_value;
    byCategory.set(r.category, entry);
  }
  return {
    total: risks.length,
    open: open.length,
    high: open.filter((r) => r.severity >= 12).length,
    exposure: open.reduce((sum, r) => sum + r.expected_value, 0),
    byCategory: [...byCategory.entries()]
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.exposure - a.exposure),
  };
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function listDocuments(projectId: string): ProjectDocument[] {
  return all<ProjectDocument>(
    `SELECT * FROM documents WHERE project_id = ?
      ORDER BY doc_number, revision DESC`,
    [projectId]
  );
}

export function documentSummary(projectId: string, dataDate: string): DocumentSummary {
  const docs = listDocuments(projectId);
  const byStatus = new Map<string, number>();
  for (const d of docs) byStatus.set(d.status, (byStatus.get(d.status) ?? 0) + 1);
  const overdue = docs.filter(
    (d) =>
      d.due_date !== null &&
      d.due_date < dataDate &&
      d.review_status !== "approved" &&
      d.status !== "as-built" &&
      d.status !== "superseded"
  ).length;
  return {
    total: docs.length,
    overdue,
    inReview: docs.filter((d) => d.review_status === "in-review").length,
    approved: docs.filter((d) => d.review_status === "approved").length,
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })),
  };
}

// ---------------------------------------------------------------------------
// Derived earned-value metrics
// ---------------------------------------------------------------------------

/**
 * Rolls the control accounts up into the standard EVM metric set. EAC uses the
 * CPI-based formula (BAC / CPI), which assumes past cost performance continues —
 * the convention most EPC owners' reps expect on a lump-sum job.
 */
export function projectMetrics(project: Project): ProjectMetrics {
  const totals = one<{
    pv: number;
    ev: number;
    ac: number;
    budget: number;
    committed: number;
    eac: number;
  }>(
    `SELECT
        COALESCE(SUM(planned_value), 0)          AS pv,
        COALESCE(SUM(earned_value), 0)           AS ev,
        COALESCE(SUM(actual_cost), 0)            AS ac,
        COALESCE(SUM(current_budget), 0)         AS budget,
        COALESCE(SUM(committed), 0)              AS committed,
        COALESCE(SUM(forecast_at_completion), 0) AS eac
      FROM cost_accounts WHERE project_id = ?`,
    [project.id]
  ) ?? { pv: 0, ev: 0, ac: 0, budget: 0, committed: 0, eac: 0 };

  const bac = totals.budget || project.budget_at_completion;
  const { pv, ev, ac, committed } = totals;

  const spi = pv > 0 ? ev / pv : 1;
  const cpi = ac > 0 ? ev / ac : 1;
  // Fall back to the CPI-derived EAC when accounts carry no explicit forecast.
  const eac = totals.eac > 0 ? totals.eac : cpi > 0 ? bac / cpi : bac;
  const remainingWork = bac - ev;

  const msPerDay = 86_400_000;
  const scheduleVarianceDays = Math.round(
    (new Date(project.forecast_finish).getTime() -
      new Date(project.baseline_finish).getTime()) /
      msPerDay
  );

  return {
    bac,
    pv,
    ev,
    ac,
    sv: ev - pv,
    cv: ev - ac,
    spi,
    cpi,
    eac,
    etc: Math.max(eac - ac, 0),
    vac: bac - eac,
    // To-complete performance index against the current budget.
    tcpi: bac - ac !== 0 ? remainingWork / (bac - ac) : 1,
    percentComplete: bac > 0 ? (ev / bac) * 100 : 0,
    percentSpent: bac > 0 ? (ac / bac) * 100 : 0,
    committed,
    scheduleVarianceDays,
  };
}

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export function listMessages(conversationId: string): ChatMessage[] {
  return all<ChatMessage>(
    `SELECT * FROM chat_messages WHERE conversation_id = ?
      ORDER BY created_at, rowid`,
    [conversationId]
  );
}

export function getOrCreateConversation(projectId: string): string {
  const existing = one<{ id: string }>(
    `SELECT id FROM conversations WHERE project_id = ?
      ORDER BY updated_at DESC LIMIT 1`,
    [projectId]
  );
  if (existing) return existing.id;

  const id = `conv-${projectId}`;
  run(
    `INSERT INTO conversations (id, project_id, title) VALUES (?, ?, ?)`,
    [id, projectId, "Project controls review"]
  );
  return id;
}
