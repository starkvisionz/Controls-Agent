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
import { daysBetween, money, percent, shortDate } from "@/lib/format";
import type { CostAccount, Project } from "@/lib/types";

/**
 * The offline analyst.
 *
 * When no ANTHROPIC_API_KEY is configured, Starkvisionz still has to answer — a
 * controls tool that goes blank without a network key is not much of a tool.
 * This module reads the same tables the Claude-backed path reads and composes
 * a grounded answer from them. It is deterministic and never invents figures.
 */

type Intent =
  | "cost"
  | "schedule"
  | "risk"
  | "documents"
  | "change"
  | "forecast"
  | "recommend"
  | "status";

const INTENT_PATTERNS: [Intent, RegExp][] = [
  ["recommend", /\b(recommend|what should|advise|action|next step|priorit|fix|recover|options?)\b/i],
  ["forecast", /\b(forecast|eac|etc|at completion|final cost|outturn|projection|vac|tcpi)\b/i],
  ["cost", /\b(cost|budget|spend|cpi|overrun|variance|commit|invoice|accrual|money|dollar|control account)\b/i],
  ["schedule", /\b(schedule|spi|critical path|float|late|slip|delay|gantt|milestone|activity|activities|finish date)\b/i],
  ["risk", /\b(risk|threat|opportunit|exposure|mitigat|severity|register)\b/i],
  ["documents", /\b(document|drawing|deliverable|transmittal|ifc|ifa|review|revision|doc control)\b/i],
  ["change", /\b(change order|variation|trend|claim|co-|scope change)\b/i],
];

function classify(question: string): Intent {
  for (const [intent, pattern] of INTENT_PATTERNS) {
    if (pattern.test(question)) return intent;
  }
  return "status";
}

const cpiOf = (a: CostAccount) => (a.actual_cost > 0 ? a.earned_value / a.actual_cost : 1);
const vacOf = (a: CostAccount) => a.current_budget - a.forecast_at_completion;

/** Renders a small markdown table. */
function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function verdict(spi: number, cpi: number): string {
  const late = spi < 0.98;
  const over = cpi < 0.98;
  if (late && over) return "**behind schedule and over cost**";
  if (late) return "**behind schedule, holding cost**";
  if (over) return "**on schedule but over cost**";
  return "**tracking at or ahead of plan on both cost and schedule**";
}

// ---------------------------------------------------------------------------

function answerStatus(p: Project): string {
  const m = projectMetrics(p);
  const accounts = listCostAccounts(p.id);
  const risks = listRisks(p.id).filter((r) => r.status !== "closed");
  const docs = documentSummary(p.id, p.data_date);
  const worst = [...accounts].filter((a) => a.actual_cost > 0).sort((a, b) => cpiOf(a) - cpiOf(b))[0];

  const out = [
    `**${p.code} — ${p.name}** as of ${shortDate(p.data_date)}.`,
    "",
    `The job is ${verdict(m.spi, m.cpi)}. SPI **${m.spi.toFixed(3)}**, CPI **${m.cpi.toFixed(3)}**, ` +
      `**${percent(m.percentComplete)}** physically complete against a ${money(m.bac, { compact: true })} budget.`,
    "",
    table(
      ["Metric", "Value", "Reads as"],
      [
        ["Schedule variance", money(m.sv, { sign: true, compact: true }), m.sv < 0 ? "behind plan" : "ahead of plan"],
        ["Cost variance", money(m.cv, { sign: true, compact: true }), m.cv < 0 ? "overspent for work done" : "underspent"],
        ["EAC", money(m.eac, { compact: true }), `VAC ${money(m.vac, { sign: true, compact: true })}`],
        ["Forecast finish", shortDate(p.forecast_finish), `${Math.abs(m.scheduleVarianceDays)}d ${m.scheduleVarianceDays > 0 ? "late" : "early"}`],
      ]
    ),
    "",
    "What is driving it:",
    "",
  ];

  if (worst) {
    out.push(
      `- **Cost.** ${worst.name} (${worst.code}) is the weakest account at CPI ${cpiOf(worst).toFixed(3)}, ` +
        `forecasting ${money(Math.abs(vacOf(worst)), { compact: true })} ${vacOf(worst) < 0 ? "over" : "under"} its ${money(worst.current_budget, { compact: true })} budget.`
    );
  }

  const slip = listSlippedTasks(p.id, 1)[0];
  if (slip) {
    out.push(
      `- **Schedule.** ${slip.name} (${slip.code}) is the largest single slip at ` +
        `${daysBetween(slip.baseline_finish, slip.forecast_finish)} days against baseline, with ${slip.total_float_days}d float.`
    );
  }

  const topRisk = risks[0];
  if (topRisk) {
    out.push(
      `- **Risk.** ${risks.length} risks open carrying ${money(risks.reduce((s, r) => s + r.expected_value, 0), { compact: true })} ` +
        `of weighted exposure; the top item is ${topRisk.code} "${topRisk.title}" at severity ${topRisk.severity}.`
    );
  }

  if (docs.overdue > 0) {
    out.push(`- **Documents.** ${docs.overdue} deliverables are past their review due date.`);
  }

  return out.join("\n");
}

function answerCost(p: Project): string {
  const m = projectMetrics(p);
  const accounts = listCostAccounts(p.id).filter((a) => a.actual_cost > 0);
  const overruns = [...accounts].filter((a) => vacOf(a) < 0).sort((a, b) => vacOf(a) - vacOf(b)).slice(0, 6);
  const under = [...accounts].filter((a) => vacOf(a) > 0).sort((a, b) => vacOf(b) - vacOf(a)).slice(0, 3);

  const byCategory = new Map<string, { budget: number; ev: number; ac: number }>();
  for (const a of accounts) {
    const e = byCategory.get(a.category) ?? { budget: 0, ev: 0, ac: 0 };
    e.budget += a.current_budget;
    e.ev += a.earned_value;
    e.ac += a.actual_cost;
    byCategory.set(a.category, e);
  }

  return [
    `Cost position on **${p.code}** at ${shortDate(p.data_date)}: CPI **${m.cpi.toFixed(3)}**, ` +
      `cost variance **${money(m.cv, { sign: true, compact: true })}**, forecast at completion **${money(m.eac, { compact: true })}** ` +
      `against a ${money(m.bac, { compact: true })} budget — a VAC of **${money(m.vac, { sign: true, compact: true })}**.`,
    "",
    `${money(m.ac, { compact: true })} spent and ${money(m.committed, { compact: true })} committed to earn ${money(m.ev, { compact: true })} of value.`,
    "",
    "### By category",
    "",
    table(
      ["Category", "Budget", "EV", "AC", "CPI"],
      [...byCategory.entries()].map(([cat, v]) => [
        cat,
        money(v.budget, { compact: true }),
        money(v.ev, { compact: true }),
        money(v.ac, { compact: true }),
        (v.ac > 0 ? v.ev / v.ac : 1).toFixed(3),
      ])
    ),
    "",
    "### Accounts forecast to overrun",
    "",
    overruns.length === 0
      ? "No control account is currently forecast above its budget."
      : table(
          ["Account", "Name", "Budget", "EAC", "VAC", "CPI"],
          overruns.map((a) => [
            a.code,
            a.name,
            money(a.current_budget, { compact: true }),
            money(a.forecast_at_completion, { compact: true }),
            money(vacOf(a), { sign: true, compact: true }),
            cpiOf(a).toFixed(3),
          ])
        ),
    "",
    under.length > 0
      ? `Offsetting these, ${under.map((a) => `**${a.code}** (${money(vacOf(a), { compact: true })} under)`).join(", ")} ` +
        `carry favourable variance that could be harvested into contingency.`
      : "",
    "",
    `TCPI is **${m.tcpi.toFixed(3)}** — the cost performance required on all remaining work to still land on budget. ` +
      (m.tcpi > m.cpi + 0.05
        ? "That is materially better than what the job has achieved to date, so the budget is unlikely to hold without intervention."
        : "That is within reach of current performance."),
  ]
    .filter(Boolean)
    .join("\n");
}

function answerSchedule(p: Project): string {
  const m = projectMetrics(p);
  const critical = listCriticalTasks(p.id, 8);
  const slipped = listSlippedTasks(p.id, 6);
  const milestones = listMilestones(p.id).filter((ms) => ms.status !== "complete").slice(0, 5);

  return [
    `Schedule position on **${p.code}**: SPI **${m.spi.toFixed(3)}**, schedule variance **${money(m.sv, { sign: true, compact: true })}** of work. ` +
      `Forecast finish **${shortDate(p.forecast_finish)}** against a baseline of ${shortDate(p.baseline_finish)} — ` +
      `**${Math.abs(m.scheduleVarianceDays)} days ${m.scheduleVarianceDays > 0 ? "late" : "early"}**.`,
    "",
    "### Critical path — least float first",
    "",
    critical.length === 0
      ? "No incomplete activities are currently on the critical path."
      : table(
          ["Activity", "Name", "%", "Float", "Forecast finish"],
          critical.map((t) => [
            t.code,
            t.name,
            `${t.percent_complete}%`,
            `${t.total_float_days}d`,
            shortDate(t.forecast_finish),
          ])
        ),
    "",
    "### Largest slips against baseline",
    "",
    slipped.length === 0
      ? "No incomplete activity is forecast to finish later than its baseline."
      : table(
          ["Activity", "Name", "Slip", "Complete"],
          slipped.map((t) => [
            t.code,
            t.name,
            `${daysBetween(t.baseline_finish, t.forecast_finish)}d`,
            `${t.percent_complete}%`,
          ])
        ),
    "",
    milestones.length > 0
      ? "### Next milestones\n\n" +
        table(
          ["Milestone", "Baseline", "Forecast", "Variance"],
          milestones.map((ms) => [
            ms.name,
            shortDate(ms.baseline_finish),
            shortDate(ms.forecast_finish),
            `${daysBetween(ms.baseline_finish, ms.forecast_finish)}d`,
          ])
        )
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function answerRisk(p: Project): string {
  const risks = listRisks(p.id);
  const open = risks.filter((r) => r.status !== "closed");
  const exposure = open.reduce((s, r) => s + r.expected_value, 0);
  const high = open.filter((r) => r.severity >= 12);
  const opportunities = open.filter((r) => r.risk_type === "opportunity");
  const stale = open.filter((r) => r.mitigation_progress < 25 && r.severity >= 12);

  const byCategory = new Map<string, number>();
  for (const r of open) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + r.expected_value);

  return [
    `**${open.length} open risks** on ${p.code} carrying **${money(exposure, { compact: true })}** of probability-weighted cost exposure. ` +
      `${high.length} sit in the high or extreme band (severity ≥ 12).`,
    "",
    "### Highest severity",
    "",
    table(
      ["Ref", "Title", "P×I", "Exposure", "Sched.", "Status", "Mitigation"],
      open.slice(0, 8).map((r) => [
        r.code,
        r.title,
        `${r.probability}×${r.impact}=${r.severity}`,
        money(r.expected_value, { compact: true }),
        `${r.schedule_impact_days}d`,
        r.status,
        `${r.mitigation_progress}%`,
      ])
    ),
    "",
    "### Exposure by category",
    "",
    [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([cat, v]) => `- **${cat}** — ${money(v, { compact: true })}`)
      .join("\n"),
    "",
    stale.length > 0
      ? `**Attention:** ${stale.length} high-severity risk${stale.length > 1 ? "s are" : " is"} still below 25% mitigation progress — ` +
        stale.map((r) => r.code).join(", ") + ". These are the ones to press owners on."
      : "All high-severity risks have mitigation underway.",
    opportunities.length > 0
      ? `\n${opportunities.length} item${opportunities.length > 1 ? "s are" : " is"} logged as an opportunity rather than a threat ` +
        `(${opportunities.map((r) => r.code).join(", ")}), worth ${money(opportunities.reduce((s, r) => s + r.expected_value, 0), { compact: true })} if realised.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function answerDocuments(p: Project): string {
  const summary = documentSummary(p.id, p.data_date);
  const pct = summary.total > 0 ? (summary.approved / summary.total) * 100 : 0;

  return [
    `Document control on **${p.code}**: **${summary.total}** documents in the register, ` +
      `**${summary.approved}** approved (${percent(pct, 0)}), **${summary.inReview}** currently in review, ` +
      `and **${summary.overdue}** past their review due date.`,
    "",
    "### By issue status",
    "",
    table(
      ["Status", "Count"],
      summary.byStatus
        .sort((a, b) => b.count - a.count)
        .map((s) => [s.status.toUpperCase(), String(s.count)])
    ),
    "",
    summary.overdue > 0
      ? `The ${summary.overdue} overdue deliverable${summary.overdue > 1 ? "s are" : " is"} the item to chase — late ` +
        `IFC releases feed straight into construction sequencing, and the schedule variance on this job is already concentrated downstream.`
      : "Nothing is overdue in the register.",
  ].join("\n");
}

function answerChange(p: Project): string {
  const changes = listChangeOrders(p.id);
  const approved = changes.filter((c) => c.status === "approved");
  const pending = changes.filter((c) => c.status === "trend" || c.status === "submitted");
  const rejected = changes.filter((c) => c.status === "rejected");
  const sum = (list: typeof changes) => list.reduce((s, c) => s + c.cost_impact, 0);

  return [
    `**${changes.length} change orders** logged on ${p.code}. ` +
      `Approved value **${money(sum(approved), { sign: true, compact: true })}** across ${approved.length} items; ` +
      `**${money(sum(pending), { sign: true, compact: true })}** across ${pending.length} still open as trends or submissions.`,
    "",
    table(
      ["Ref", "Title", "Origin", "Status", "Cost", "Sched."],
      changes
        .slice(0, 10)
        .map((c) => [
          c.code,
          c.title,
          c.origin,
          c.status,
          money(c.cost_impact, { sign: true, compact: true }),
          `${c.schedule_impact_days}d`,
        ])
    ),
    "",
    pending.length > 0
      ? `The open pipeline is the number to watch: if the ${pending.length} pending item${pending.length > 1 ? "s land" : " lands"} ` +
        `as submitted, the budget moves by ${money(sum(pending), { sign: true, compact: true })}.`
      : "Nothing is pending — the change log is fully dispositioned.",
    rejected.length > 0 ? `${rejected.length} item${rejected.length > 1 ? "s were" : " was"} rejected and should be reviewed for claim exposure.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function answerForecast(p: Project): string {
  const m = projectMetrics(p);
  const accounts = listCostAccounts(p.id).filter((a) => a.actual_cost > 0);
  const drivers = [...accounts].sort((a, b) => vacOf(a) - vacOf(b)).slice(0, 5);
  const independentEac = m.cpi > 0 ? m.bac / m.cpi : m.bac;

  return [
    `Forecast at completion for **${p.code}** is **${money(m.eac, { compact: true })}** — a variance at completion of ` +
      `**${money(m.vac, { sign: true, compact: true })}** against the ${money(m.bac, { compact: true })} current budget.`,
    "",
    table(
      ["Basis", "EAC", "Assumption"],
      [
        ["Control-account roll-up", money(m.eac, { compact: true }), "each account's own forecast, summed"],
        ["BAC ÷ CPI", money(independentEac, { compact: true }), "current cost performance continues to completion"],
        ["AC + (BAC − EV)", money(m.ac + (m.bac - m.ev), { compact: true }), "remaining work delivered exactly to budget"],
      ]
    ),
    "",
    `${money(m.etc, { compact: true })} remains to spend (ETC), against ${money(m.bac - m.ev, { compact: true })} of work still to earn. ` +
      `TCPI is **${m.tcpi.toFixed(3)}** versus a CPI of ${m.cpi.toFixed(3)} achieved so far.`,
    "",
    "### What is moving the forecast",
    "",
    table(
      ["Account", "Name", "VAC", "CPI"],
      drivers.map((a) => [a.code, a.name, money(vacOf(a), { sign: true, compact: true }), cpiOf(a).toFixed(3)])
    ),
    "",
    m.vac < 0
      ? `The roll-up and the CPI-based forecast ${Math.abs(m.eac - independentEac) / m.bac < 0.02 ? "agree closely, which raises confidence in the overrun" : "differ, so the account-level forecasts are worth re-testing"}.`
      : "The forecast currently holds within budget.",
  ].join("\n");
}

function answerRecommend(p: Project): string {
  const m = projectMetrics(p);
  const accounts = listCostAccounts(p.id).filter((a) => a.actual_cost > 0);
  const worst = [...accounts].sort((a, b) => vacOf(a) - vacOf(b)).slice(0, 3);
  const critical = listCriticalTasks(p.id, 3);
  const risks = listRisks(p.id).filter((r) => r.status !== "closed" && r.severity >= 12).slice(0, 3);
  const docs = documentSummary(p.id, p.data_date);

  const actions: string[] = [];

  if (worst[0] && vacOf(worst[0]) < 0) {
    actions.push(
      `**Get a bottom-up re-forecast on ${worst.map((a) => a.code).join(", ")}.** ` +
        `${worst[0].name} alone carries ${money(Math.abs(vacOf(worst[0])), { compact: true })} of the variance at completion. ` +
        `The CPI-based EAC assumes past performance continues — on an account this far off, that assumption needs testing against the remaining quantities, not extrapolated.`
    );
  }

  if (critical[0]) {
    actions.push(
      `**Put ${critical[0].code} — ${critical[0].name} — on daily reporting.** ` +
        `It has ${critical[0].total_float_days}d of float and is ${critical[0].percent_complete}% complete, forecast to finish ${shortDate(critical[0].forecast_finish)}. ` +
        `Every day it moves, the completion date moves with it.`
    );
  }

  if (risks[0]) {
    actions.push(
      `**Force a mitigation review on ${risks.map((r) => r.code).join(", ")}.** ` +
        `${risks[0].code} "${risks[0].title}" sits at severity ${risks[0].severity} with mitigation only ${risks[0].mitigation_progress}% advanced ` +
        `and ${money(risks[0].cost_impact, { compact: true })} of worst-case exposure.`
    );
  }

  if (docs.overdue > 0) {
    actions.push(
      `**Clear the ${docs.overdue} overdue deliverables.** Late document turnaround is upstream of the construction sequence; it converts into schedule variance one revision cycle later.`
    );
  }

  if (m.tcpi > m.cpi + 0.05) {
    actions.push(
      `**Reset the budget expectation with the client.** Holding the ${money(m.bac, { compact: true })} budget now requires TCPI ${m.tcpi.toFixed(3)} ` +
        `against a delivered CPI of ${m.cpi.toFixed(3)}. That gap does not close on exhortation — it closes on scope, method, or budget.`
    );
  }

  return [
    `Given SPI ${m.spi.toFixed(3)} and CPI ${m.cpi.toFixed(3)} on **${p.code}**, these are the moves I would make, in order:`,
    "",
    actions.length > 0
      ? actions.map((a, i) => `${i + 1}. ${a}`).join("\n\n")
      : "The job is tracking to plan on cost, schedule, risk, and document control. The recommendation is to hold the current controls cadence and re-test at the next period close.",
  ].join("\n");
}

const ANSWERS: Record<Intent, (p: Project) => string> = {
  status: answerStatus,
  cost: answerCost,
  schedule: answerSchedule,
  risk: answerRisk,
  documents: answerDocuments,
  change: answerChange,
  forecast: answerForecast,
  recommend: answerRecommend,
};

/** Produces the full offline answer for a question about a project. */
export function localAnswer(project: Project, question: string): string {
  return ANSWERS[classify(question)](project);
}
