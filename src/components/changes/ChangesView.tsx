"use client";

import { useMemo, useState } from "react";
import { GitPullRequestArrow, Plus, TrendingUp } from "lucide-react";
import { useResource } from "@/lib/use-resource";
import { useProjects } from "@/components/shell/ProjectContext";
import { useSession } from "@/components/shell/SessionContext";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/Table";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Stat, Meter } from "@/components/ui/Stat";
import {
  LoadingPane,
  SearchInput,
  Segmented,
  Select,
  StateMessage,
  Toolbar,
} from "@/components/ui/Controls";
import { ChangeMovement } from "@/components/charts/ChangeMovement";
import { money, percent, shortDate } from "@/lib/format";
import { CHANGE_ORIGINS, CHANGE_STATUSES } from "@/lib/validation";
import type { ChangeOrderSummary, DecisionCycle } from "@/lib/change-orders";
import type { ChangeOrderRow, Project, ProjectMetrics } from "@/lib/types";
import { ChangeOrderDetail } from "./ChangeOrderDetail";
import { RaiseChangeOrder } from "./RaiseChangeOrder";

export const STATUS_TONE: Record<string, Tone> = {
  trend: "neutral",
  submitted: "info",
  approved: "good",
  rejected: "bad",
};

export type ChangesPayload = {
  project: Project;
  metrics: ProjectMetrics;
  changeOrders: ChangeOrderRow[];
  summary: ChangeOrderSummary;
  cycle: DecisionCycle;
  accounts: { id: string; code: string; name: string; category: string; current_budget: number }[];
  nextCode: string;
};

type StatusFilter = "all" | "open" | (typeof CHANGE_STATUSES)[number];

/**
 * The change-order register, and the commercial position it produces.
 *
 * The page is arranged around one distinction: approved orders are money the
 * budget carries, everything else is exposure it does not. Reporting the two as
 * one figure is how a forecast quietly absorbs a claim nobody has agreed to
 * pay, so they never share a tile, a bar, or a total here.
 */
export function ChangesView() {
  const { activeProjectId, refresh } = useProjects();
  const { can } = useSession();
  const { data, error, loading, reload } = useResource<ChangesPayload>(
    activeProjectId ? `/api/projects/${activeProjectId}/change-orders` : null
  );

  /** Approving moves the project budget, so the chrome has to re-read too. */
  const reloadAll = () => {
    reload();
    refresh();
  };

  const [status, setStatus] = useState<StatusFilter>("all");
  const [origin, setOrigin] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [raising, setRaising] = useState(false);

  const editable = can("cost:write", activeProjectId);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    return data.changeOrders.filter((c) => {
      if (status === "open" ? c.status === "approved" || c.status === "rejected" : status !== "all" && c.status !== status) {
        return false;
      }
      if (origin !== "all" && c.origin !== origin) return false;
      if (!needle) return true;
      return (
        c.code.toLowerCase().includes(needle) ||
        c.title.toLowerCase().includes(needle) ||
        c.client_ref.toLowerCase().includes(needle) ||
        c.owner.toLowerCase().includes(needle) ||
        (c.account_code ?? "").toLowerCase().includes(needle)
      );
    });
  }, [data, status, origin, query]);

  if (loading) return <LoadingPane label="Loading the change register" />;
  if (error || !data) {
    return <StateMessage title="Could not load change orders" detail={error ?? undefined} />;
  }

  const { summary, cycle } = data;
  const approvedShare =
    summary.originalBudget > 0 ? (summary.approved.value / summary.originalBudget) * 100 : 0;
  const current = selected ? data.changeOrders.find((c) => c.id === selected) ?? null : null;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <Toolbar>
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: `All ${data.changeOrders.length}` },
              { value: "open", label: `Open ${summary.pending.count}` },
              ...CHANGE_STATUSES.map((s) => ({
                value: s,
                label: `${s} ${data.changeOrders.filter((c) => c.status === s).length}`,
              })),
            ]}
          />
          <Select
            label="Origin"
            value={origin}
            onChange={setOrigin}
            options={[
              { value: "all", label: "All" },
              ...CHANGE_ORIGINS.map((o) => ({ value: o, label: o })),
            ]}
          />
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Find a change order…"
            className="w-[220px]"
          />
          {editable ? (
            <button
              onClick={() => setRaising(true)}
              className="ml-auto flex h-6 shrink-0 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-2 text-2xs text-accent-hi transition-colors hover:bg-accent/15"
            >
              <Plus className="h-3 w-3" />
              Raise a trend
            </button>
          ) : null}
        </Toolbar>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="@container">
            <div className="grid grid-cols-2 gap-2 @3xl:grid-cols-4">
              <Stat
                label="Approved changes"
                value={money(summary.approved.value, { compact: true, sign: true })}
                tone={summary.approved.value > 0 ? "warn" : "good"}
                icon={<GitPullRequestArrow />}
                context={`${summary.approved.count} orders · ${percent(approvedShare, 1)} of the original budget`}
              />
              <Stat
                label="Pending exposure"
                value={money(summary.pending.value, { compact: true, sign: true })}
                tone={summary.pending.value > 0 ? "bad" : "neutral"}
                icon={<TrendingUp />}
                context={`${summary.pending.count} open · ${
                  summary.originalBudget > 0
                    ? percent((summary.pending.value / summary.originalBudget) * 100, 1)
                    : "—"
                } of the original budget`}
              />
              <Stat
                label="Approved days"
                value={`${summary.approvedDays > 0 ? "+" : ""}${summary.approvedDays}d`}
                tone={summary.approvedDays > 0 ? "warn" : "neutral"}
                context="recorded, not applied to the forecast"
              />
              <Stat
                label="Decision turnaround"
                value={cycle.median === null ? "—" : `${cycle.median}d`}
                tone={cycle.median !== null && cycle.median > 60 ? "warn" : "neutral"}
                context={
                  cycle.count === 0
                    ? "nothing decided yet"
                    : `median of ${cycle.count} decided · longest ${cycle.longest}d`
                }
              />
            </div>

            {/* The bridge from the original budget to the current one is two
                numbers, and two numbers read better as a sentence than as a
                chart whose steps are under a percent of its own bars. */}
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-panel border border-line bg-chrome px-3 py-2 text-2xs">
              <span className="text-ink-faint">Original budget</span>
              <span className="font-mono text-ink-dim tabular">
                {money(summary.originalBudget)}
              </span>
              <span className="text-ink-faint">→ approved change</span>
              <span
                className={`font-mono tabular ${
                  summary.approved.value > 0 ? "text-warn" : "text-good"
                }`}
              >
                {money(summary.approved.value, { sign: true })}
              </span>
              <span className="text-ink-faint">→ current budget</span>
              <span className="font-mono text-ink tabular">{money(summary.currentBudget)}</span>
              {summary.pending.value !== 0 ? (
                <span className="text-ink-faint">
                  · a further{" "}
                  <span className="font-mono text-warn tabular">
                    {money(summary.pending.value, { sign: true })}
                  </span>{" "}
                  is open and in no budget
                </span>
              ) : null}
            </div>

            <div className="mt-2 grid grid-cols-1 gap-2 @4xl:grid-cols-[1.6fr_1fr]">
              <ChangeMovement orders={data.changeOrders} className="h-[280px]" />
              <OriginBreakdown orders={data.changeOrders} />
            </div>

            {summary.unallocatedApproved !== 0 ? (
              <p className="mt-2 rounded-panel border border-bad/30 bg-bad-wash px-3 py-2 text-2xs text-bad">
                {money(summary.unallocatedApproved, { sign: true })} of approved change is not
                allocated to a control account, so it is not in any budget. Allocate it, or the
                register and the cost position disagree.
              </p>
            ) : null}

            <Panel flush className="mt-2">
              <PanelHeader
                title="Change register"
                subtitle={`${rows.length} of ${data.changeOrders.length} shown`}
              />
              <TableWrap className="max-h-[520px]">
                <Table fill>
                  <THead>
                    <TH width="72px">Ref</TH>
                    <TH width="280px">Title</TH>
                    <TH width="110px">Origin</TH>
                    <TH width="96px">Status</TH>
                    <TH width="110px">Account</TH>
                    <TH align="right" width="104px">Cost</TH>
                    <TH align="right" width="72px">Earned</TH>
                    <TH align="right" width="64px">Days</TH>
                    <TH width="96px">Raised</TH>
                    <TH width="96px">Decided</TH>
                    <TH width="110px">Owner</TH>
                  </THead>
                  <tbody>
                    {rows.map((c) => (
                      <TR
                        key={c.id}
                        onClick={() => setSelected(c.id)}
                        selected={c.id === selected}
                      >
                        <TD mono className="text-ink-mute">{c.code}</TD>
                        <TD className="truncate text-ink-dim" title={c.title}>{c.title}</TD>
                        <TD className="text-ink-mute">{c.origin}</TD>
                        <TD>
                          <Badge tone={STATUS_TONE[c.status] ?? "neutral"}>{c.status}</Badge>
                        </TD>
                        <TD mono className={c.account_code ? "text-ink-mute" : "text-ink-faint"}
                            title={c.account_name ?? "not allocated"}>
                          {c.account_code ?? "—"}
                        </TD>
                        <TD
                          align="right"
                          mono
                          className={c.cost_impact > 0 ? "text-warn" : "text-good"}
                        >
                          {money(c.cost_impact, { sign: true, compact: true })}
                        </TD>
                        <TD
                          align="right"
                          mono
                          className={
                            c.status !== "approved"
                              ? "text-ink-faint"
                              : c.percent_complete > 0
                                ? "text-ink-mute"
                                : "text-ink-faint"
                          }
                          title={
                            c.status === "approved"
                              ? "Progress on this change's own work — approved scope earns only as it is performed"
                              : "Only approved scope earns"
                          }
                        >
                          {c.status === "approved" ? percent(c.percent_complete, 0) : "—"}
                        </TD>
                        <TD
                          align="right"
                          mono
                          className={c.schedule_impact_days > 0 ? "text-warn" : "text-ink-faint"}
                        >
                          {c.schedule_impact_days}d
                        </TD>
                        <TD mono className="text-ink-faint">{shortDate(c.raised_date)}</TD>
                        <TD mono className="text-ink-faint">{shortDate(c.decision_date)}</TD>
                        <TD className="truncate text-ink-mute">{c.owner || "—"}</TD>
                      </TR>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
              {rows.length === 0 ? (
                <StateMessage title="Nothing matches those filters" />
              ) : null}
            </Panel>
          </div>
        </div>
      </div>

      {current ? (
        <ChangeOrderDetail
          // Remounted per order, and per saved revision, so the form resets
          // without a reset effect.
          key={`${current.id}:${current.status}:${current.cost_impact}`}
          order={current}
          accounts={data.accounts}
          metrics={data.metrics}
          onClose={() => setSelected(null)}
          onSaved={reloadAll}
        />
      ) : null}

      {raising ? (
        <RaiseChangeOrder
          projectId={data.project.id}
          nextCode={data.nextCode}
          dataDate={data.project.data_date}
          accounts={data.accounts}
          onClose={() => setRaising(false)}
          onSaved={() => {
            setRaising(false);
            reloadAll();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Where the change is coming from.
 *
 * Four rows of two numbers is a table, not a chart — and the split that matters
 * commercially is client-driven against everything else, because one is
 * recoverable and the rest is the project's own.
 */
function OriginBreakdown({ orders }: { orders: ChangeOrderRow[] }) {
  const rows = CHANGE_ORIGINS.map((origin) => {
    const mine = orders.filter((c) => c.origin === origin);
    return {
      origin,
      approved: mine.filter((c) => c.status === "approved").reduce((s, c) => s + c.cost_impact, 0),
      pending: mine
        .filter((c) => c.status === "trend" || c.status === "submitted")
        .reduce((s, c) => s + c.cost_impact, 0),
      count: mine.length,
    };
  }).filter((r) => r.count > 0);

  const largest = Math.max(1, ...rows.map((r) => Math.abs(r.approved) + Math.abs(r.pending)));

  return (
    <Panel className="min-h-[260px]">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="text-2xs font-medium text-ink-dim">Where change comes from</h3>
        <span className="text-[10px] text-ink-faint">approved and open, by origin</span>
      </div>

      {rows.length === 0 ? (
        <StateMessage title="No change orders logged" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <div key={row.origin}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-2xs text-ink-dim">{row.origin}</span>
                <span className="shrink-0 font-mono text-2xs text-ink tabular">
                  {money(row.approved, { compact: true, sign: true })}
                </span>
              </div>
              <Meter
                value={Math.abs(row.approved)}
                max={largest}
                tone={row.approved > 0 ? "warn" : "good"}
                className="mt-1"
              />
              <div className="mt-1 flex items-baseline justify-between gap-2 text-[10px] text-ink-faint">
                <span>
                  {row.count} order{row.count === 1 ? "" : "s"}
                  {row.pending !== 0 ? (
                    <>
                      {" · "}
                      <span className="text-warn">
                        {money(row.pending, { compact: true, sign: true })} still open
                      </span>
                    </>
                  ) : null}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
