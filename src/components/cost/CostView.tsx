"use client";

import { useMemo, useState } from "react";
import { Badge, Dot, type Tone } from "@/components/ui/Badge";
import { Stat } from "@/components/ui/Stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/Table";
import {
  LoadingPane,
  SearchInput,
  Segmented,
  Select,
  StateMessage,
  Toolbar,
} from "@/components/ui/Controls";
import { VarianceBars } from "@/components/charts/VarianceBars";
import { CashFlow } from "@/components/charts/CashFlow";
import { useProjects } from "@/components/shell/ProjectContext";
import { useResource } from "@/lib/use-resource";
import { index, money, percent, shortDate } from "@/lib/format";
import type {
  ChangeOrder,
  CostAccount,
  CostEntry,
  EvmPeriod,
  Project,
  ProjectMetrics,
  WbsNode,
} from "@/lib/types";

type CostPayload = {
  project: Project;
  metrics: ProjectMetrics;
  accounts: CostAccount[];
  entries: CostEntry[];
  evm: EvmPeriod[];
  changeOrders: ChangeOrder[];
  wbs: WbsNode[];
};

type Tab = "accounts" | "ledger" | "changes";
type SortKey = "code" | "budget" | "cpi" | "vac" | "committed";

const CHANGE_TONE: Record<string, Tone> = {
  approved: "good",
  rejected: "bad",
  submitted: "info",
  trend: "warn",
};

const ENTRY_TONE: Record<string, Tone> = {
  posted: "neutral",
  pending: "warn",
  disputed: "bad",
};

export function CostView() {
  const { activeProjectId } = useProjects();
  const { data, loading, error } = useResource<CostPayload>(
    activeProjectId ? `/api/projects/${activeProjectId}/cost` : null
  );

  const [tab, setTab] = useState<Tab>("accounts");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("vac");

  const categories = useMemo(() => {
    const set = new Set((data?.accounts ?? []).map((a) => a.category));
    return ["all", ...[...set]];
  }, [data]);

  const accounts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = (data?.accounts ?? []).filter((a) => {
      if (category !== "all" && a.category !== category) return false;
      if (needle && !`${a.code} ${a.name} ${a.cost_type}`.toLowerCase().includes(needle)) return false;
      return true;
    });

    const cpi = (a: CostAccount) => (a.actual_cost > 0 ? a.earned_value / a.actual_cost : 1);
    const vac = (a: CostAccount) => a.current_budget - a.forecast_at_completion;

    return rows.sort((a, b) => {
      switch (sort) {
        case "budget":
          return b.current_budget - a.current_budget;
        case "committed":
          return b.committed - a.committed;
        case "cpi":
          return cpi(a) - cpi(b);
        case "vac":
          return vac(a) - vac(b);
        default:
          return a.code.localeCompare(b.code);
      }
    });
  }, [data, category, query, sort]);

  const entries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byAccount = new Map((data?.accounts ?? []).map((a) => [a.id, a]));
    return (data?.entries ?? [])
      .filter((e) => {
        const account = byAccount.get(e.cost_account_id);
        if (category !== "all" && account?.category !== category) return false;
        if (needle && !`${e.vendor} ${e.reference} ${e.description}`.toLowerCase().includes(needle)) {
          return false;
        }
        return true;
      })
      .map((e) => ({ entry: e, account: byAccount.get(e.cost_account_id) }));
  }, [data, category, query]);

  if (loading) return <LoadingPane label="Loading cost data" />;
  if (error || !data) {
    return <StateMessage title="Could not load cost data" detail={error ?? undefined} />;
  }

  const m = data.metrics;
  const approvedChanges = data.changeOrders
    .filter((c) => c.status === "approved")
    .reduce((s, c) => s + c.cost_impact, 0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "accounts", label: `Control accounts ${data.accounts.length}` },
            { value: "ledger", label: `Ledger ${data.entries.length}` },
            { value: "changes", label: `Changes ${data.changeOrders.length}` },
          ]}
        />
        {tab !== "changes" ? (
          <Select
            label="Category"
            value={category}
            onChange={setCategory}
            options={categories.map((c) => ({ value: c, label: c === "all" ? "All" : c }))}
          />
        ) : null}
        {tab === "accounts" ? (
          <Select
            label="Sort"
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={[
              { value: "vac", label: "Worst variance" },
              { value: "cpi", label: "Worst CPI" },
              { value: "budget", label: "Largest budget" },
              { value: "committed", label: "Most committed" },
              { value: "code", label: "Account code" },
            ]}
          />
        ) : null}
        <SearchInput value={query} onChange={setQuery} placeholder="Filter…" className="ml-auto w-48 min-w-40 grow sm:grow-0" />
      </Toolbar>

      <div className="@container min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @5xl:grid-cols-6">
            <Stat
              label="Current budget"
              value={money(m.bac, { compact: true })}
              context={`incl. ${money(approvedChanges, { sign: true, compact: true })} approved change`}
            />
            <Stat
              label="Committed"
              value={money(m.committed, { compact: true })}
              context={`${percent((m.committed / m.bac) * 100, 0)} of budget`}
            />
            <Stat
              label="Actual cost"
              value={money(m.ac, { compact: true })}
              context={`${percent(m.percentSpent, 0)} spent for ${percent(m.percentComplete, 0)} earned`}
            />
            <Stat
              label="Forecast · EAC"
              value={money(m.eac, { compact: true })}
              tone={m.vac < 0 ? "bad" : "good"}
              context={`ETC ${money(m.etc, { compact: true })} remaining`}
            />
            <Stat
              label="Variance · VAC"
              value={money(m.vac, { sign: true, compact: true })}
              tone={m.vac < 0 ? "bad" : "good"}
              context={`CPI ${index(m.cpi)}`}
            />
            <Stat
              label="To complete · TCPI"
              value={index(m.tcpi)}
              tone={m.tcpi > m.cpi + 0.05 ? "bad" : m.tcpi > m.cpi ? "warn" : "good"}
              context={`vs CPI ${index(m.cpi)} achieved`}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-2">
            <CashFlow periods={data.evm} className="h-[280px]" />
            <VarianceBars accounts={data.accounts} className="h-[280px]" />
          </div>

          <div className="panel flex min-h-[320px] flex-col">
            {tab === "accounts" ? (
              <AccountsTable accounts={accounts} />
            ) : tab === "ledger" ? (
              <LedgerTable rows={entries} />
            ) : (
              <ChangesTable changes={data.changeOrders} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AccountsTable({ accounts }: { accounts: CostAccount[] }) {
  if (accounts.length === 0) return <StateMessage title="No control accounts match this filter" />;

  const totals = accounts.reduce(
    (t, a) => ({
      budget: t.budget + a.current_budget,
      committed: t.committed + a.committed,
      ac: t.ac + a.actual_cost,
      ev: t.ev + a.earned_value,
      eac: t.eac + a.forecast_at_completion,
    }),
    { budget: 0, committed: 0, ac: 0, ev: 0, eac: 0 }
  );

  return (
    <TableWrap>
      <Table>
        <THead>
          <TH width="72px">Account</TH>
          <TH width="184px">Description</TH>
          <TH width="90px">Category</TH>
          <TH align="right" width="76px">Changes</TH>
          <TH align="right" width="82px">Budget</TH>
          <TH align="right" width="78px">Committed</TH>
          <TH align="right" width="82px">Actual</TH>
          <TH align="right" width="82px">Earned</TH>
          <TH align="right" width="54px">CPI</TH>
          <TH align="right" width="82px">EAC</TH>
          <TH align="right" width="82px">VAC</TH>
        </THead>
        <tbody>
          {accounts.map((a) => {
            const cpi = a.actual_cost > 0 ? a.earned_value / a.actual_cost : 1;
            const vac = a.current_budget - a.forecast_at_completion;
            return (
              <TR key={a.id}>
                <TD mono className="text-ink-mute">{a.code}</TD>
                <TD>
                  <span className="flex items-center gap-1.5">
                    <Dot tone={vac < 0 ? "bad" : "good"} />
                    <span className="truncate text-ink-dim">{a.name}</span>
                  </span>
                </TD>
                <TD className="text-ink-mute">{a.category}</TD>
                <TD
                  align="right"
                  mono
                  className={a.approved_changes === 0 ? "text-ink-faint" : a.approved_changes > 0 ? "text-warn" : "text-good"}
                >
                  {a.approved_changes === 0 ? "—" : money(a.approved_changes, { sign: true, compact: true })}
                </TD>
                <TD align="right" mono className="text-ink-dim">
                  {money(a.current_budget, { compact: true })}
                </TD>
                <TD align="right" mono className="text-ink-mute">
                  {money(a.committed, { compact: true })}
                </TD>
                <TD align="right" mono className="text-ink-dim">
                  {money(a.actual_cost, { compact: true })}
                </TD>
                <TD align="right" mono className="text-ink-mute">
                  {money(a.earned_value, { compact: true })}
                </TD>
                <TD align="right" mono className={cpi >= 1 ? "text-good" : cpi >= 0.95 ? "text-warn" : "text-bad"}>
                  {cpi.toFixed(3)}
                </TD>
                <TD align="right" mono className="text-ink-dim">
                  {money(a.forecast_at_completion, { compact: true })}
                </TD>
                <TD align="right" mono className={vac < 0 ? "text-bad" : "text-good"}>
                  {money(vac, { sign: true, compact: true })}
                </TD>
              </TR>
            );
          })}
        </tbody>
        <tfoot className="sticky bottom-0 bg-chrome">
          <tr className="border-t border-line-strong">
            <TD colSpan={4} className="label">
              {accounts.length} accounts
            </TD>
            <TD align="right" mono className="text-ink">{money(totals.budget, { compact: true })}</TD>
            <TD align="right" mono className="text-ink-dim">{money(totals.committed, { compact: true })}</TD>
            <TD align="right" mono className="text-ink">{money(totals.ac, { compact: true })}</TD>
            <TD align="right" mono className="text-ink-dim">{money(totals.ev, { compact: true })}</TD>
            <TD align="right" mono className={totals.ev / totals.ac >= 1 ? "text-good" : "text-bad"}>
              {(totals.ev / totals.ac || 0).toFixed(3)}
            </TD>
            <TD align="right" mono className="text-ink">{money(totals.eac, { compact: true })}</TD>
            <TD
              align="right"
              mono
              className={totals.budget - totals.eac < 0 ? "text-bad" : "text-good"}
            >
              {money(totals.budget - totals.eac, { sign: true, compact: true })}
            </TD>
          </tr>
        </tfoot>
      </Table>
    </TableWrap>
  );
}

function LedgerTable({
  rows,
}: {
  rows: { entry: CostEntry; account: CostAccount | undefined }[];
}) {
  if (rows.length === 0) return <StateMessage title="No transactions match this filter" />;

  return (
    <TableWrap>
      <Table>
        <THead>
          <TH width="90px">Date</TH>
          <TH width="90px">Type</TH>
          <TH width="90px">Reference</TH>
          <TH width="160px">Vendor</TH>
          <TH width="240px">Description</TH>
          <TH width="80px">Account</TH>
          <TH align="right" width="100px">Amount</TH>
          <TH width="80px">Status</TH>
        </THead>
        <tbody>
          {rows.map(({ entry, account }) => (
            <TR key={entry.id}>
              <TD mono className="text-ink-mute">{shortDate(entry.entry_date)}</TD>
              <TD className="text-ink-faint">{entry.entry_type}</TD>
              <TD mono className="text-ink-mute">{entry.reference}</TD>
              <TD className="truncate text-ink-dim" title={entry.vendor}>{entry.vendor}</TD>
              <TD className="truncate text-ink-mute" title={entry.description}>{entry.description}</TD>
              <TD mono className="text-ink-faint" title={account?.name}>{account?.code ?? "—"}</TD>
              <TD align="right" mono className="text-ink-dim">{money(entry.amount)}</TD>
              <TD>
                <Badge tone={ENTRY_TONE[entry.status] ?? "neutral"}>{entry.status}</Badge>
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

function ChangesTable({ changes }: { changes: ChangeOrder[] }) {
  if (changes.length === 0) return <StateMessage title="No change orders logged" />;

  return (
    <TableWrap>
      <Table>
        <THead>
          <TH width="70px">Ref</TH>
          <TH width="240px">Title</TH>
          <TH width="300px">Description</TH>
          <TH width="110px">Origin</TH>
          <TH width="90px">Status</TH>
          <TH align="right" width="100px">Cost</TH>
          <TH align="right" width="70px">Sched.</TH>
          <TH width="90px">Raised</TH>
          <TH width="90px">Decided</TH>
        </THead>
        <tbody>
          {changes.map((c) => (
            <TR key={c.id}>
              <TD mono className="text-ink-mute">{c.code}</TD>
              <TD className="truncate text-ink-dim" title={c.title}>{c.title}</TD>
              <TD className="truncate text-ink-faint" title={c.description}>{c.description}</TD>
              <TD className="text-ink-mute">{c.origin}</TD>
              <TD>
                <Badge tone={CHANGE_TONE[c.status] ?? "neutral"}>{c.status}</Badge>
              </TD>
              <TD align="right" mono className={c.cost_impact > 0 ? "text-warn" : "text-good"}>
                {money(c.cost_impact, { sign: true, compact: true })}
              </TD>
              <TD align="right" mono className={c.schedule_impact_days > 0 ? "text-warn" : "text-ink-faint"}>
                {c.schedule_impact_days}d
              </TD>
              <TD mono className="text-ink-faint">{shortDate(c.raised_date)}</TD>
              <TD mono className="text-ink-faint">{shortDate(c.decision_date)}</TD>
            </TR>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}
