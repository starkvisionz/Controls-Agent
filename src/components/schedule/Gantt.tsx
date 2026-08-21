"use client";

import { useMemo } from "react";
import { ChevronDown, ChevronRight, Diamond } from "lucide-react";
import { buildRows, dayOffset, monthTicks, rollUpWbs, type GanttRow } from "./gantt-model";
import { daysBetween, money, percent, shortDate } from "@/lib/format";
import type { Task, WbsNode } from "@/lib/types";

const NAME_COL = 300;
const ROW_H = 24;

const STATUS_FILL: Record<Task["status"], string> = {
  complete: "var(--color-series-3)",
  "in-progress": "var(--color-accent)",
  blocked: "var(--color-bad)",
  "not-started": "var(--color-line-strong)",
};

export function Gantt({
  wbs,
  tasks,
  dataDate,
  dayWidth,
  collapsed,
  onToggle,
  selectedId,
  onSelect,
}: {
  wbs: WbsNode[];
  tasks: Task[];
  dataDate: string;
  dayWidth: number;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (task: Task) => void;
}) {
  const { rows, origin, totalDays, ticks } = useMemo(() => {
    const rollups = rollUpWbs(wbs, tasks);
    const rows = buildRows(wbs, tasks, rollups, collapsed);

    // The timeline must cover baseline and forecast alike, plus a little air.
    const dates = tasks.flatMap((t) => [
      t.baseline_start,
      t.baseline_finish,
      t.forecast_start,
      t.forecast_finish,
    ]);
    const min = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : dataDate;
    const max = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : dataDate;

    const originDate = new Date(min);
    originDate.setUTCDate(originDate.getUTCDate() - 14);
    const origin = originDate.toISOString().slice(0, 10);
    const totalDays = daysBetween(origin, max) + 30;

    return { rows, origin, totalDays, ticks: monthTicks(origin, totalDays, dayWidth) };
  }, [wbs, tasks, collapsed, dataDate, dayWidth]);

  const timelineWidth = Math.max(totalDays * dayWidth, 400);
  const todayX = dayOffset(origin, dataDate) * dayWidth;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <div style={{ width: NAME_COL + timelineWidth }}>
        {/* Timeline header */}
        <div className="sticky top-0 z-20 flex h-8 border-b border-line-strong bg-chrome">
          <div
            className="sticky left-0 z-10 flex shrink-0 items-center border-r border-line-strong bg-chrome px-2"
            style={{ width: NAME_COL }}
          >
            <span className="label">Work breakdown structure</span>
          </div>
          <div className="relative" style={{ width: timelineWidth }}>
            {ticks.map((tick) => (
              <div
                key={tick.offsetDays}
                className="absolute top-0 h-8 border-l"
                style={{
                  left: tick.offsetDays * dayWidth,
                  borderColor: tick.major ? "var(--color-line-strong)" : "var(--color-line-soft)",
                }}
              >
                <span
                  className={`ml-1 whitespace-nowrap text-[10px] leading-8 ${
                    tick.major ? "font-medium text-ink-mute" : "text-ink-faint"
                  }`}
                >
                  {tick.label}
                </span>
              </div>
            ))}
            <div
              className="absolute top-0 h-8 border-l border-accent"
              style={{ left: todayX }}
              title={`Data date — ${shortDate(dataDate)}`}
            />
          </div>
        </div>

        {/* Rows */}
        <div className="relative">
          {/* Gridlines and the data-date rule sit behind every bar. */}
          <div
            className="pointer-events-none absolute inset-y-0 z-0"
            style={{ left: NAME_COL, width: timelineWidth }}
          >
            {ticks.map((tick) => (
              <div
                key={tick.offsetDays}
                className="absolute inset-y-0 border-l"
                style={{
                  left: tick.offsetDays * dayWidth,
                  borderColor: tick.major ? "var(--color-line)" : "var(--color-line-soft)",
                }}
              />
            ))}
            <div className="absolute inset-y-0 border-l border-accent/50" style={{ left: todayX }} />
          </div>

          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              origin={origin}
              dayWidth={dayWidth}
              timelineWidth={timelineWidth}
              selected={row.kind === "task" && row.id === selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Row({
  row,
  origin,
  dayWidth,
  timelineWidth,
  selected,
  onToggle,
  onSelect,
}: {
  row: GanttRow;
  origin: string;
  dayWidth: number;
  timelineWidth: number;
  selected: boolean;
  onToggle: (id: string) => void;
  onSelect: (task: Task) => void;
}) {
  const isWbs = row.kind === "wbs";

  return (
    <div
      className={`relative z-10 flex border-b border-line-soft ${
        selected ? "bg-accent-wash" : isWbs ? "bg-chrome/60" : "row-hover"
      }`}
      style={{ height: ROW_H }}
      onClick={() => (row.kind === "task" ? onSelect(row.task) : onToggle(row.id))}
    >
      <div
        className={`sticky left-0 z-10 flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-line-strong px-2 ${
          selected ? "bg-overlay" : isWbs ? "bg-chrome" : "bg-surface"
        }`}
        style={{ width: NAME_COL, paddingLeft: 8 + row.level * 12 }}
      >
        {isWbs ? (
          <>
            {row.hasChildren ? (
              row.expanded ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-ink-faint" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-ink-faint" />
              )
            ) : (
              <span className="w-3 shrink-0" />
            )}
            <span className="shrink-0 font-mono text-[10px] text-ink-faint tabular">{row.code}</span>
            <span
              className={`truncate text-2xs ${row.level === 0 ? "font-medium text-ink" : "text-ink-dim"}`}
            >
              {row.name}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-faint tabular">
              {Math.round(row.percentComplete)}%
            </span>
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            {row.task.is_critical && row.task.status !== "complete" ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-bad" title="On the critical path" />
            ) : (
              <span className="w-1.5 shrink-0" />
            )}
            <span className="truncate text-2xs text-ink-mute" title={row.task.name}>
              {row.task.name}
            </span>
            <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-faint tabular">
              {percent(row.task.percent_complete, 0)}
            </span>
          </>
        )}
      </div>

      <div className="relative" style={{ width: timelineWidth }}>
        {isWbs ? (
          <SummaryBar row={row} origin={origin} dayWidth={dayWidth} />
        ) : (
          <TaskBars task={row.task} origin={origin} dayWidth={dayWidth} />
        )}
      </div>
    </div>
  );
}

function SummaryBar({
  row,
  origin,
  dayWidth,
}: {
  row: Extract<GanttRow, { kind: "wbs" }>;
  origin: string;
  dayWidth: number;
}) {
  if (!row.start || !row.finish) return null;

  const left = dayOffset(origin, row.start) * dayWidth;
  const width = Math.max(daysBetween(row.start, row.finish) * dayWidth, 2);

  return (
    <div
      className="absolute top-1/2 -translate-y-1/2 rounded-[2px] bg-line-strong"
      style={{ left, width, height: row.level === 0 ? 7 : 5 }}
      title={`${row.name} · ${shortDate(row.start)} → ${shortDate(row.finish)} · ${money(row.budget, { compact: true })}`}
    >
      <div
        className="h-full rounded-[2px] bg-ink-faint"
        style={{ width: `${Math.min(100, row.percentComplete)}%` }}
      />
    </div>
  );
}

function TaskBars({ task, origin, dayWidth }: { task: Task; origin: string; dayWidth: number }) {
  const baselineLeft = dayOffset(origin, task.baseline_start) * dayWidth;
  const baselineWidth = Math.max(
    daysBetween(task.baseline_start, task.baseline_finish) * dayWidth,
    2
  );
  const left = dayOffset(origin, task.forecast_start) * dayWidth;
  const width = Math.max(daysBetween(task.forecast_start, task.forecast_finish) * dayWidth, 2);
  const slip = daysBetween(task.baseline_finish, task.forecast_finish);

  const tooltip =
    `${task.code} — ${task.name}\n` +
    `Baseline: ${shortDate(task.baseline_start)} → ${shortDate(task.baseline_finish)}\n` +
    `Forecast: ${shortDate(task.forecast_start)} → ${shortDate(task.forecast_finish)}` +
    (slip !== 0 ? ` (${slip > 0 ? "+" : ""}${slip}d)` : "") +
    `\n${percent(task.percent_complete, 1)} complete · float ${task.total_float_days}d`;

  if (task.is_milestone) {
    return (
      <div
        className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ left }}
        title={tooltip}
      >
        <Diamond
          className={`h-3 w-3 ${
            task.status === "complete"
              ? "fill-good text-good"
              : slip > 0
                ? "fill-bad text-bad"
                : "fill-accent text-accent"
          }`}
        />
      </div>
    );
  }

  return (
    <div title={tooltip}>
      {/* Baseline, drawn as a thin unfilled rule above the live bar. */}
      <div
        className="absolute top-[5px] rounded-[1px] border border-line-strong"
        style={{ left: baselineLeft, width: baselineWidth, height: 3 }}
      />
      <div
        className="absolute top-[11px] overflow-hidden rounded-[2px]"
        style={{
          left,
          width,
          height: 8,
          background: "var(--color-raised)",
          boxShadow: task.is_critical && task.status !== "complete"
            ? "inset 0 0 0 1px var(--color-bad)"
            : "inset 0 0 0 1px var(--color-line-strong)",
        }}
      >
        <div
          className="h-full"
          style={{
            width: `${Math.max(task.percent_complete, task.status === "complete" ? 100 : 0)}%`,
            background: STATUS_FILL[task.status],
          }}
        />
      </div>
    </div>
  );
}
