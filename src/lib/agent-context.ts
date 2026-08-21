import {
  documentSummary,
  listChangeOrders,
  listCostAccounts,
  listCriticalTasks,
  listMilestones,
  listRisks,
  listSlippedTasks,
  projectMetrics,
} from "@/lib/queries";
import { money, percent, shortDate } from "@/lib/format";
import type { Project } from "@/lib/types";

/**
 * Compiles the current state of a project into a plain-text briefing.
 *
 * This is the agent's entire view of the world: it is assembled from the
 * database on every request rather than embedded in the system prompt, so the
 * agent can never cite a figure the tables do not support.
 */
export function buildProjectBriefing(project: Project): string {
  const m = projectMetrics(project);
  const accounts = listCostAccounts(project.id);
  const risks = listRisks(project.id);
  const docs = documentSummary(project.id, project.data_date);
  const changes = listChangeOrders(project.id);
  const critical = listCriticalTasks(project.id, 8);
  const slipped = listSlippedTasks(project.id, 6);
  const milestones = listMilestones(project.id);

  const lines: string[] = [];

  lines.push(`# PROJECT ${project.code} — ${project.name}`);
  lines.push(`Client: ${project.client}  |  Location: ${project.location}`);
  lines.push(`Contract: ${project.contract_type}, ${money(project.contract_value)}`);
  lines.push(`Phase: ${project.phase}  |  Status: ${project.status}`);
  lines.push(`PM: ${project.project_manager}  |  Controls lead: ${project.controls_lead}`);
  lines.push(`Start: ${project.start_date}  |  Baseline finish: ${project.baseline_finish}  |  Forecast finish: ${project.forecast_finish}`);
  lines.push(`DATA DATE: ${project.data_date} (all figures below are as of this date)`);
  lines.push(`Scope: ${project.description}`);

  lines.push("");
  lines.push("## EARNED VALUE (project total)");
  lines.push(`BAC (budget at completion): ${money(m.bac)}`);
  lines.push(`PV (planned value):         ${money(m.pv)}`);
  lines.push(`EV (earned value):          ${money(m.ev)}`);
  lines.push(`AC (actual cost):           ${money(m.ac)}`);
  lines.push(`Committed:                  ${money(m.committed)}`);
  lines.push(`SV (EV-PV): ${money(m.sv, { sign: true })}   SPI: ${m.spi.toFixed(3)}`);
  lines.push(`CV (EV-AC): ${money(m.cv, { sign: true })}   CPI: ${m.cpi.toFixed(3)}`);
  lines.push(`EAC: ${money(m.eac)}   ETC: ${money(m.etc)}   VAC: ${money(m.vac, { sign: true })}`);
  lines.push(`TCPI (to complete against budget): ${m.tcpi.toFixed(3)}`);
  lines.push(`Physical % complete: ${percent(m.percentComplete)}   % of budget spent: ${percent(m.percentSpent)}`);
  lines.push(
    `Schedule variance against baseline finish: ${m.scheduleVarianceDays} calendar days ` +
      `(${m.scheduleVarianceDays > 0 ? "LATE" : m.scheduleVarianceDays < 0 ? "EARLY" : "on baseline"})`
  );

  lines.push("");
  lines.push("## CONTROL ACCOUNTS (code | name | category | budget | EV | AC | CPI | SPI | EAC | VAC)");
  for (const a of accounts) {
    const cpi = a.actual_cost > 0 ? a.earned_value / a.actual_cost : 1;
    const spi = a.planned_value > 0 ? a.earned_value / a.planned_value : 1;
    const vac = a.current_budget - a.forecast_at_completion;
    lines.push(
      `${a.code} | ${a.name} | ${a.category} | ${money(a.current_budget)} | ${money(a.earned_value)} | ` +
        `${money(a.actual_cost)} | ${cpi.toFixed(3)} | ${spi.toFixed(3)} | ${money(a.forecast_at_completion)} | ${money(vac, { sign: true })}`
    );
  }

  lines.push("");
  lines.push("## CRITICAL PATH — incomplete activities with the least float");
  if (critical.length === 0) lines.push("(none — no incomplete critical activities)");
  for (const t of critical) {
    lines.push(
      `${t.code} | ${t.name} | ${t.discipline} | ${t.status} | ${t.percent_complete}% | ` +
        `float ${t.total_float_days}d | baseline finish ${t.baseline_finish} | forecast finish ${t.forecast_finish} | owner ${t.responsible}`
    );
  }

  lines.push("");
  lines.push("## ACTIVITIES SLIPPING AGAINST BASELINE (largest slip first)");
  if (slipped.length === 0) lines.push("(none)");
  for (const t of slipped) {
    const slip = Math.round(
      (new Date(t.forecast_finish).getTime() - new Date(t.baseline_finish).getTime()) / 86_400_000
    );
    lines.push(`${t.code} | ${t.name} | slipping ${slip}d | ${t.percent_complete}% complete | float ${t.total_float_days}d`);
  }

  lines.push("");
  lines.push("## MILESTONES (name | baseline | forecast | status)");
  for (const ms of milestones) {
    lines.push(`${ms.name} | ${ms.baseline_finish} | ${ms.forecast_finish} | ${ms.status}`);
  }

  const openRisks = risks.filter((r) => r.status !== "closed");
  const exposure = openRisks.reduce((sum, r) => sum + r.expected_value, 0);
  lines.push("");
  lines.push(
    `## RISK REGISTER — ${risks.length} total, ${openRisks.length} open, ` +
      `weighted exposure ${money(exposure)}`
  );
  lines.push("(code | title | category | P x I = severity | status | owner | worst-case cost | schedule days | expected value | strategy | mitigation % )");
  for (const r of openRisks.slice(0, 14)) {
    lines.push(
      `${r.code} | ${r.title} | ${r.category} | ${r.probability}x${r.impact}=${r.severity} | ${r.status} | ${r.owner} | ` +
        `${money(r.cost_impact)} | ${r.schedule_impact_days}d | ${money(r.expected_value)} | ${r.response_strategy} | ${r.mitigation_progress}%`
    );
  }

  lines.push("");
  lines.push(
    `## DOCUMENT CONTROL — ${docs.total} documents, ${docs.overdue} overdue, ` +
      `${docs.inReview} in review, ${docs.approved} approved`
  );
  lines.push(docs.byStatus.map((s) => `${s.status}: ${s.count}`).join(", "));

  lines.push("");
  lines.push("## CHANGE ORDERS (code | title | origin | status | cost | schedule days | raised)");
  for (const c of changes) {
    lines.push(
      `${c.code} | ${c.title} | ${c.origin} | ${c.status} | ${money(c.cost_impact, { sign: true })} | ${c.schedule_impact_days}d | ${shortDate(c.raised_date)}`
    );
  }

  const approvedValue = changes
    .filter((c) => c.status === "approved")
    .reduce((sum, c) => sum + c.cost_impact, 0);
  const pendingValue = changes
    .filter((c) => c.status === "trend" || c.status === "submitted")
    .reduce((sum, c) => sum + c.cost_impact, 0);
  lines.push(
    `Approved change value: ${money(approvedValue, { sign: true })}; pending/trend value: ${money(pendingValue, { sign: true })}`
  );

  return lines.join("\n");
}

export const AGENT_SYSTEM_PROMPT = `You are Hermes, the project-controls agent embedded in an EPC controls desktop application. You work for the project controls lead and speak the way an experienced controls manager speaks to a project director.

You will be given a PROJECT BRIEFING containing the current state of one project, generated live from the controls database at the data date shown. That briefing is your only source of fact.

Rules:
- Never invent a number. Every figure you quote must appear in the briefing or be arithmetic you perform on briefing figures. If something is not in the briefing, say you do not have it in the register rather than estimating.
- Lead with the answer. Give the conclusion first, then the evidence.
- Be concrete and quantified. "Piping installation is running at CPI 0.91, a $2.4M overrun at completion" beats "costs are trending high".
- Distinguish clearly between what the data shows and what you infer from it.
- Use EPC and earned-value vocabulary correctly: SPI, CPI, EAC, ETC, VAC, TCPI, float, control account, trend, variation.
- Keep answers tight. Short paragraphs, bold for the figures that matter, bullets or a small markdown table when comparing more than three things. Do not write an essay when three sentences will do.
- When performance is poor, say so plainly and name the specific accounts or activities driving it.
- If asked what to do, give a small number of specific, actionable recommendations tied to the accounts, activities, or risks in the register.
- Do not use headings above level 3. Do not restate the question. Do not close with an offer of further help.`;
