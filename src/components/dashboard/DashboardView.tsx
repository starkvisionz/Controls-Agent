"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  Flag,
  Gauge,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Badge, Dot, type Tone } from "@/components/ui/Badge";
import { Meter, Stat } from "@/components/ui/Stat";
import { LoadingPane, StateMessage } from "@/components/ui/Controls";
import { SCurve } from "@/components/charts/SCurve";
import { IndexTrend } from "@/components/charts/IndexTrend";
import { CostBreakdown } from "@/components/charts/CostBreakdown";
import { useProjects } from "@/components/shell/ProjectContext";
import { useResource } from "@/lib/use-resource";
import {
  daysBetween,
  index,
  indexTone,
  money,
  percent,
  severityBand,
  shortDate,
} from "@/lib/format";
import type {
  ChangeOrder,
  CostAccount,
  DocumentSummary,
  EvmPeriod,
  Project,
  ProjectMetrics,
  RiskSummary,
  Task,
} from "@/lib/types";

type Overview = {
  project: Project;
  metrics: ProjectMetrics;
  evm: EvmPeriod[];
  costAccounts: CostAccount[];
  milestones: Task[];
  criticalTasks: Task[];
  slippedTasks: Task[];
  changeOrders: ChangeOrder[];
  risks: RiskSummary;
  documents: DocumentSummary;
};

const BAND_TONE: Record<string, Tone> = {
  low: "good",
  medium: "warn",
  high: "bad",
  extreme: "bad",
};

export function DashboardView() {
  const { activeProjectId } = useProjects();
  const { data, loading, error } = useResource<Overview>(
    activeProjectId ? `/api/projects/${activeProjectId}` : null
  );

  if (loading) return <LoadingPane label="Loading project overview" />;
  if (error || !data) {
    return <StateMessage title="Could not load this project" detail={error ?? undefined} />;
  }

  const { project, metrics: m, evm, costAccounts, milestones, criticalTasks, risks, documents } = data;
  const late = m.scheduleVarianceDays;

  return (
    <div className="@container h-full overflow-y-auto">
      <ProjectHeader project={project} metrics={m} />

      <div className="flex flex-col gap-3 p-3 pt-0">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @5xl:grid-cols-6">
          <Stat
            label="Schedule · SPI"
            value={index(m.spi)}
            tone={indexTone(m.spi)}
            icon={<Gauge />}
            context={`SV ${money(m.sv, { sign: true, compact: true })} of work`}
            spark={m.spi >= 1 ? <TrendingUp className="h-3.5 w-3.5 text-good" /> : <TrendingDown className="h-3.5 w-3.5 text-bad" />}
          />
          <Stat
            label="Cost · CPI"
            value={index(m.cpi)}
            tone={indexTone(m.cpi)}
            icon={<Gauge />}
            context={`CV ${money(m.cv, { sign: true, compact: true })} on work done`}
            spark={m.cpi >= 1 ? <TrendingUp className="h-3.5 w-3.5 text-good" /> : <TrendingDown className="h-3.5 w-3.5 text-bad" />}
          />
          <Stat
            label="Forecast · EAC"
            value={money(m.eac, { compact: true })}
            tone={m.vac < 0 ? "bad" : "good"}
            icon={<CircleDollarSign />}
            context={`VAC ${money(m.vac, { sign: true, compact: true })} on ${money(m.bac, { compact: true })}`}
          />
          <Stat
            label="Complete"
            value={percent(m.percentComplete)}
            icon={<Flag />}
            context={`${percent(m.percentSpent)} of budget spent`}
            spark={<div className="w-16"><Meter value={m.percentComplete} tone="accent" /></div>}
          />
          <Stat
            label="Finish"
            value={shortDate(project.forecast_finish)}
            tone={late > 0 ? "bad" : late < 0 ? "good" : "neutral"}
            icon={<CalendarClock />}
            context={
              late === 0 ? "on the baseline date" : `${Math.abs(late)}d ${late > 0 ? "late" : "early"} vs baseline`
            }
          />
          <Stat
            label="Risk exposure"
            value={money(risks.exposure, { compact: true })}
            tone={risks.high > 0 ? "warn" : "neutral"}
            icon={<AlertTriangle />}
            context={`${risks.open} open · ${risks.high} high severity`}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-3">
          <SCurve periods={evm} dataDate={project.data_date} className="h-[320px] @4xl:col-span-2" />
          <IndexTrend periods={evm} className="h-[320px]" />
        </div>

        <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
          <CostBreakdown accounts={costAccounts} className="h-[300px]" />
          <VarianceTable accounts={costAccounts} />
        </div>

        <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2 @5xl:grid-cols-3">
          <MilestonePanel milestones={milestones} />
          <CriticalPanel tasks={criticalTasks} />
          <AttentionPanel risks={risks} documents={documents} changeOrders={data.changeOrders} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProjectHeader({ project, metrics }: { project: Project; metrics: ProjectMetrics }) {
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-line bg-chrome px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-sm font-medium text-ink">{project.name}</h1>
          <Badge tone="accent">{project.contract_type}</Badge>
          <Badge tone={project.status === "active" ? "good" : "neutral"}>{project.phase}</Badge>
        </div>
        <p className="mt-0.5 text-2xs text-ink-mute">
          {project.client} · {project.location} · PM {project.project_manager} · Controls{" "}
          {project.controls_lead}
        </p>
      </div>

      <dl className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-2xs tabular">
        <HeaderField label="Contract" value={money(project.contract_value, { compact: true })} />
        <HeaderField label="BAC" value={money(metrics.bac, { compact: true })} />
        <HeaderField label="Committed" value={money(metrics.committed, { compact: true })} />
        <HeaderField label="Start" value={shortDate(project.start_date)} />
        <HeaderField label="Baseline finish" value={shortDate(project.baseline_finish)} />
      </dl>
    </div>
  );
}

function HeaderField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="label">{label}</dt>
      <dd className="text-ink-dim">{value}</dd>
    </div>
  );
}

function VarianceTable({ accounts }: { accounts: CostAccount[] }) {
  const worst = [...accounts]
    .filter((a) => a.actual_cost > 0)
    .sort((a, b) => a.current_budget - a.forecast_at_completion - (b.current_budget - b.forecast_at_completion))
    .slice(0, 8);

  return (
    <Panel flush className="h-[300px]">
      <PanelHeader
        title="Largest variances at completion"
        subtitle="control accounts"
        icon={<TrendingDown />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-2xs">
          <tbody>
            {worst.map((a) => {
              const vac = a.current_budget - a.forecast_at_completion;
              const cpi = a.actual_cost > 0 ? a.earned_value / a.actual_cost : 1;
              return (
                <tr key={a.id} className="row-hover border-b border-line-soft">
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <Dot tone={vac < 0 ? "bad" : "good"} />
                      <span className="font-mono text-ink-mute tabular">{a.code}</span>
                      <span className="truncate text-ink-dim">{a.name}</span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-ink-mute tabular">
                    {money(a.current_budget, { compact: true })}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono tabular ${cpi >= 1 ? "text-good" : "text-bad"}`}
                  >
                    {cpi.toFixed(3)}
                  </td>
                  <td
                    className={`px-2 py-1.5 text-right font-mono tabular ${vac < 0 ? "text-bad" : "text-good"}`}
                  >
                    {money(vac, { sign: true, compact: true })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function MilestonePanel({ milestones }: { milestones: Task[] }) {
  return (
    <Panel flush className="h-[260px]">
      <PanelHeader title="Milestones" icon={<Flag />} />
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <ol className="flex flex-col gap-0">
          {milestones.map((ms, i) => {
            const drift = daysBetween(ms.baseline_finish, ms.forecast_finish);
            const done = ms.status === "complete";
            return (
              <li key={ms.id} className="flex gap-2.5">
                {/* Timeline rail */}
                <div className="flex flex-col items-center">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full border ${
                      done
                        ? "border-good bg-good"
                        : drift > 0
                          ? "border-bad bg-bad-wash"
                          : "border-line-strong bg-raised"
                    }`}
                  />
                  {i < milestones.length - 1 ? <span className="w-px flex-1 bg-line" /> : null}
                </div>
                <div className="min-w-0 flex-1 pb-2.5">
                  <div className="flex items-baseline gap-2">
                    <span className={`truncate text-2xs ${done ? "text-ink-mute" : "text-ink-dim"}`}>
                      {ms.name}
                    </span>
                    {drift !== 0 && !done ? (
                      <span
                        className={`ml-auto shrink-0 font-mono text-[10px] tabular ${drift > 0 ? "text-bad" : "text-good"}`}
                      >
                        {drift > 0 ? "+" : ""}
                        {drift}d
                      </span>
                    ) : null}
                  </div>
                  <div className="font-mono text-[10px] text-ink-faint tabular">
                    {shortDate(ms.forecast_finish)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </Panel>
  );
}

function CriticalPanel({ tasks }: { tasks: Task[] }) {
  return (
    <Panel flush className="h-[260px]">
      <PanelHeader title="Critical path" subtitle="least float first" icon={<CalendarClock />} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <StateMessage title="Nothing on the critical path" />
        ) : (
          <table className="w-full border-collapse text-2xs">
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="row-hover border-b border-line-soft">
                  <td className="px-2 py-1.5">
                    <div className="truncate text-ink-dim" title={t.name}>
                      {t.name}
                    </div>
                    <div className="font-mono text-[10px] text-ink-faint tabular">
                      {t.code} · {t.discipline} · {shortDate(t.forecast_finish)}
                    </div>
                  </td>
                  <td className="w-14 px-2 py-1.5 text-right">
                    <div className="font-mono text-ink-mute tabular">{t.percent_complete}%</div>
                    <Meter
                      value={t.percent_complete}
                      tone={t.status === "blocked" ? "bad" : "accent"}
                      className="mt-1"
                    />
                  </td>
                  <td
                    className={`w-12 px-2 py-1.5 text-right font-mono tabular ${
                      t.total_float_days <= 0 ? "text-bad" : "text-warn"
                    }`}
                  >
                    {t.total_float_days}d
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Panel>
  );
}

function AttentionPanel({
  risks,
  documents,
  changeOrders,
}: {
  risks: RiskSummary;
  documents: DocumentSummary;
  changeOrders: ChangeOrder[];
}) {
  const pending = changeOrders.filter((c) => c.status === "trend" || c.status === "submitted");
  const pendingValue = pending.reduce((s, c) => s + c.cost_impact, 0);

  return (
    <Panel flush className="h-[260px]">
      <PanelHeader title="Needs attention" icon={<AlertTriangle />} />
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-1.5">
          <AlertRow
            href="/risk"
            tone={risks.high > 0 ? "bad" : "good"}
            title={`${risks.high} high-severity risk${risks.high === 1 ? "" : "s"} open`}
            detail={`${money(risks.exposure, { compact: true })} weighted exposure across ${risks.open} open items`}
          />
          <AlertRow
            href="/documents"
            tone={documents.overdue > 0 ? "warn" : "good"}
            title={`${documents.overdue} deliverable${documents.overdue === 1 ? "" : "s"} overdue`}
            detail={`${documents.inReview} in review · ${documents.approved} of ${documents.total} approved`}
          />
          <AlertRow
            href="/cost"
            tone={pending.length > 0 ? "info" : "good"}
            title={`${pending.length} change order${pending.length === 1 ? "" : "s"} pending`}
            detail={`${money(pendingValue, { sign: true, compact: true })} of unapproved cost movement`}
          />
        </div>

        <div className="label mb-1.5 mt-3">Risk exposure by category</div>
        <div className="flex flex-col gap-1">
          {risks.byCategory.slice(0, 6).map((c) => {
            const max = risks.byCategory[0]?.exposure || 1;
            return (
              <div key={c.category} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-2xs text-ink-mute">{c.category}</span>
                <Meter value={c.exposure} max={max} tone="accent" className="flex-1" />
                <span className="w-12 shrink-0 text-right font-mono text-[10px] text-ink-faint tabular">
                  {money(c.exposure, { compact: true })}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function AlertRow({
  href,
  tone,
  title,
  detail,
}: {
  href: string;
  tone: Tone;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-start gap-2 rounded-sm border border-line bg-raised px-2 py-1.5 transition-colors hover:border-line-strong"
    >
      <span className="mt-1">
        <Dot tone={tone} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-2xs text-ink-dim">{title}</span>
        <span className="block truncate text-[10px] text-ink-faint">{detail}</span>
      </span>
    </Link>
  );
}

// Referenced by the risk band legend elsewhere; kept beside the tone map it uses.
export { BAND_TONE, severityBand };
