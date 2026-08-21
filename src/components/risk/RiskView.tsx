"use client";

import { useMemo, useState } from "react";
import { Badge, Dot, type Tone } from "@/components/ui/Badge";
import { Meter, Stat } from "@/components/ui/Stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/Table";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import {
  LoadingPane,
  SearchInput,
  Segmented,
  Select,
  StateMessage,
  Toolbar,
} from "@/components/ui/Controls";
import { RiskMatrix } from "./RiskMatrix";
import { RiskDetail } from "./RiskDetail";
import { useProjects } from "@/components/shell/ProjectContext";
import { useResource } from "@/lib/use-resource";
import { money, severityBand, shortDate } from "@/lib/format";
import type { Project, Risk, RiskSummary, WbsNode } from "@/lib/types";

type RiskPayload = { project: Project; risks: Risk[]; summary: RiskSummary; wbs: WbsNode[] };

type Scope = "open" | "high" | "threats" | "opportunities" | "all";

const BAND_TONE: Record<string, Tone> = {
  low: "good",
  medium: "warn",
  high: "bad",
  extreme: "bad",
};

const STATUS_TONE: Record<string, Tone> = {
  open: "bad",
  mitigating: "warn",
  monitoring: "info",
  closed: "neutral",
  realised: "bad",
};

export function RiskView() {
  const { activeProjectId } = useProjects();
  const { data, loading, error } = useResource<RiskPayload>(
    activeProjectId ? `/api/projects/${activeProjectId}/risks` : null
  );

  const [scope, setScope] = useState<Scope>("open");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [cell, setCell] = useState<{ probability: number; impact: number } | null>(null);
  const [selected, setSelected] = useState<Risk | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Risk>>({});

  const allRisks = useMemo(
    () => (data?.risks ?? []).map((r) => overrides[r.id] ?? r),
    [data, overrides]
  );

  const categories = useMemo(() => {
    const set = new Set(allRisks.map((r) => r.category));
    return ["all", ...[...set].sort()];
  }, [allRisks]);

  // The matrix always plots the current scope; the table narrows further when
  // a cell is picked, so clicking a cell drills in rather than re-filtering.
  const scoped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allRisks.filter((r) => {
      if (category !== "all" && r.category !== category) return false;
      if (needle && !`${r.code} ${r.title} ${r.owner} ${r.description}`.toLowerCase().includes(needle)) {
        return false;
      }
      switch (scope) {
        case "open":
          return r.status !== "closed";
        case "high":
          return r.status !== "closed" && r.severity >= 12;
        case "threats":
          return r.risk_type === "threat" && r.status !== "closed";
        case "opportunities":
          return r.risk_type === "opportunity";
        default:
          return true;
      }
    });
  }, [allRisks, scope, category, query]);

  const listed = useMemo(() => {
    const rows = cell
      ? scoped.filter((r) => r.probability === cell.probability && r.impact === cell.impact)
      : scoped;
    return [...rows].sort((a, b) => b.severity - a.severity || a.code.localeCompare(b.code));
  }, [scoped, cell]);

  const stats = useMemo(() => {
    const open = allRisks.filter((r) => r.status !== "closed");
    return {
      open: open.length,
      high: open.filter((r) => r.severity >= 12).length,
      exposure: open.reduce((s, r) => s + r.expected_value, 0),
      worstCase: open.reduce((s, r) => s + r.cost_impact, 0),
      scheduleDays: open.reduce((s, r) => Math.max(s, r.schedule_impact_days), 0),
      stalled: open.filter((r) => r.severity >= 12 && r.mitigation_progress < 25).length,
    };
  }, [allRisks]);

  const applyEdit = (risk: Risk) => {
    setOverrides((prev) => ({ ...prev, [risk.id]: risk }));
    setSelected(risk);
  };

  if (loading) return <LoadingPane label="Loading risk register" />;
  if (error || !data) {
    return <StateMessage title="Could not load the risk register" detail={error ?? undefined} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <Segmented
          value={scope}
          onChange={(v) => {
            setScope(v);
            setCell(null);
          }}
          options={[
            { value: "open", label: `Open ${stats.open}` },
            { value: "high", label: `High ${stats.high}` },
            { value: "threats", label: "Threats" },
            { value: "opportunities", label: "Opportunities" },
            { value: "all", label: "All" },
          ]}
        />
        <Select
          label="Category"
          value={category}
          onChange={setCategory}
          options={categories.map((c) => ({ value: c, label: c === "all" ? "All" : c }))}
        />
        <SearchInput value={query} onChange={setQuery} placeholder="Find a risk…" className="ml-auto w-48 min-w-40 grow sm:grow-0" />
      </Toolbar>

      <div className="flex min-h-0 flex-1">
        <div className="@container min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-3 p-3">
            <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @5xl:grid-cols-5">
              <Stat label="Open risks" value={String(stats.open)} context={`${data.risks.length} in the register`} />
              <Stat
                label="High severity"
                value={String(stats.high)}
                tone={stats.high > 0 ? "bad" : "good"}
                context="severity ≥ 12"
              />
              <Stat
                label="Weighted exposure"
                value={money(stats.exposure, { compact: true })}
                tone="warn"
                context={`${money(stats.worstCase, { compact: true })} worst case`}
              />
              <Stat
                label="Worst schedule risk"
                value={`${stats.scheduleDays}d`}
                context="largest single delay exposure"
              />
              <Stat
                label="Mitigation stalled"
                value={String(stats.stalled)}
                tone={stats.stalled > 0 ? "bad" : "good"}
                context="high severity, under 25% done"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 @4xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
              <Panel>
                <div className="mb-2 flex items-baseline justify-between">
                  <h3 className="text-2xs font-medium text-ink-dim">Probability / impact matrix</h3>
                  {cell ? (
                    <button
                      onClick={() => setCell(null)}
                      className="text-[10px] text-accent-hi hover:underline"
                    >
                      clear cell filter
                    </button>
                  ) : (
                    <span className="text-[10px] text-ink-faint">click a cell to drill in</span>
                  )}
                </div>
                <RiskMatrix risks={scoped} selectedCell={cell} onSelectCell={setCell} />
              </Panel>

              <Panel flush>
                <PanelHeader
                  title="Exposure by category"
                  subtitle={`${scoped.length} risks in scope`}
                />
                <div className="min-h-0 flex-1 overflow-y-auto p-3">
                  <CategoryBars risks={scoped} />
                </div>
              </Panel>
            </div>

            <Panel flush className="min-h-[300px]">
              <PanelHeader
                title="Risk register"
                subtitle={
                  cell
                    ? `probability ${cell.probability} × impact ${cell.impact} — ${listed.length} risks`
                    : `${listed.length} risks`
                }
              />
              {listed.length === 0 ? (
                <StateMessage title="No risks match these filters" />
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <TH width="62px">Ref</TH>
                      <TH width="260px">Title</TH>
                      <TH width="110px">Category</TH>
                      <TH align="center" width="92px">P × I</TH>
                      <TH width="76px">Band</TH>
                      <TH width="92px">Status</TH>
                      <TH width="96px">Owner</TH>
                      <TH align="right" width="86px">Exposure</TH>
                      <TH align="right" width="60px">Sched.</TH>
                      <TH width="104px">Mitigation</TH>
                      <TH width="86px">Review</TH>
                    </THead>
                    <tbody>
                      {listed.map((r) => {
                        const band = severityBand(r.severity);
                        return (
                          <TR
                            key={r.id}
                            onClick={() => setSelected(r)}
                            selected={selected?.id === r.id}
                          >
                            <TD mono className="text-ink-mute">{r.code}</TD>
                            <TD>
                              <span className="flex items-center gap-1.5">
                                <Dot tone={r.risk_type === "opportunity" ? "good" : BAND_TONE[band]} />
                                <span className="truncate text-ink-dim" title={r.title}>{r.title}</span>
                              </span>
                            </TD>
                            <TD className="text-ink-mute">{r.category}</TD>
                            <TD align="center" mono className="text-ink-mute">
                              {r.probability}×{r.impact} = {r.severity}
                            </TD>
                            <TD>
                              {/* Severity reads as upside on an opportunity, so
                                  the alarm tones are suppressed there. */}
                              <Badge tone={r.risk_type === "opportunity" ? "good" : BAND_TONE[band]}>
                                {band}
                              </Badge>
                            </TD>
                            <TD>
                              <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                            </TD>
                            <TD className="truncate text-ink-mute">{r.owner}</TD>
                            <TD align="right" mono className="text-ink-dim">
                              {money(r.expected_value, { compact: true })}
                            </TD>
                            <TD align="right" mono className="text-ink-faint">
                              {r.schedule_impact_days}d
                            </TD>
                            <TD>
                              <span className="flex items-center gap-1.5">
                                <Meter
                                  value={r.mitigation_progress}
                                  tone={
                                    r.mitigation_progress >= 75
                                      ? "good"
                                      : r.mitigation_progress >= 30
                                        ? "warn"
                                        : "bad"
                                  }
                                  className="flex-1"
                                />
                                <span className="w-7 shrink-0 text-right font-mono text-[10px] text-ink-faint tabular">
                                  {r.mitigation_progress}%
                                </span>
                              </span>
                            </TD>
                            <TD mono className="text-ink-faint">{shortDate(r.review_date)}</TD>
                          </TR>
                        );
                      })}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </Panel>
          </div>
        </div>

        {selected ? (
          <RiskDetail risk={selected} onClose={() => setSelected(null)} onSaved={applyEdit} />
        ) : null}
      </div>
    </div>
  );
}

function CategoryBars({ risks }: { risks: Risk[] }) {
  const byCategory = new Map<string, { exposure: number; count: number; high: number }>();
  for (const r of risks) {
    const e = byCategory.get(r.category) ?? { exposure: 0, count: 0, high: 0 };
    e.exposure += r.expected_value;
    e.count += 1;
    if (r.severity >= 12) e.high += 1;
    byCategory.set(r.category, e);
  }

  const rows = [...byCategory.entries()].sort((a, b) => b[1].exposure - a[1].exposure);
  const max = rows[0]?.[1].exposure || 1;

  if (rows.length === 0) return <StateMessage title="Nothing in scope" />;

  return (
    <div className="flex flex-col gap-2">
      {rows.map(([category, v]) => (
        <div key={category} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate text-2xs text-ink-mute" title={category}>
            {category}
          </span>
          <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ink-faint tabular">
            {v.count}
          </span>
          <Meter value={v.exposure} max={max} tone={v.high > 0 ? "bad" : "warn"} className="flex-1" />
          <span className="w-14 shrink-0 text-right font-mono text-[10px] text-ink-dim tabular">
            {money(v.exposure, { compact: true })}
          </span>
        </div>
      ))}
    </div>
  );
}
