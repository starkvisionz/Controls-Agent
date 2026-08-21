"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS, ChartFrame, GRID, Legend, SERIES, TooltipShell } from "./chart-theme";
import { money } from "@/lib/format";
import type { CostAccount } from "@/lib/types";

const CATEGORY_ORDER = [
  "Project Management",
  "Engineering",
  "Procurement",
  "Construction",
  "Commissioning",
  "Closeout",
];

function rollUp(accounts: CostAccount[]) {
  const map = new Map<string, { budget: number; ev: number; ac: number; eac: number }>();
  for (const a of accounts) {
    const e = map.get(a.category) ?? { budget: 0, ev: 0, ac: 0, eac: 0 };
    e.budget += a.current_budget;
    e.ev += a.earned_value;
    e.ac += a.actual_cost;
    e.eac += a.forecast_at_completion;
    map.set(a.category, e);
  }
  return [...map.entries()]
    .sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]))
    .map(([category, v]) => ({ category, ...v }));
}

/** Budget, earned value and actual cost side by side for each phase of work. */
export function CostBreakdown({
  accounts,
  className = "",
}: {
  accounts: CostAccount[];
  className?: string;
}) {
  const rows = rollUp(accounts);

  return (
    <ChartFrame
      title="Cost by phase"
      subtitle="Budget, earned value and actual cost"
      legend={
        <Legend
          items={[
            { label: "Budget", color: "var(--color-line-strong)" },
            { label: "Earned value", color: SERIES.earned },
            { label: "Actual cost", color: SERIES.actual },
          ]}
        />
      }
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 0, right: 12, bottom: 0, left: 4 }}
          barCategoryGap="30%"
          // A 2px gap keeps adjacent bars from reading as one mark.
          barGap={2}
        >
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis
            type="number"
            stroke={AXIS.stroke}
            tick={AXIS.tick}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => money(v, { compact: true })}
          />
          <YAxis
            type="category"
            dataKey="category"
            stroke={AXIS.stroke}
            tick={AXIS.tick}
            tickLine={false}
            axisLine={false}
            width={92}
          />

          <Tooltip
            cursor={{ fill: "var(--color-raised)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof rows)[number];
              const cpi = p.ac > 0 ? p.ev / p.ac : 1;
              return (
                <TooltipShell
                  title={p.category}
                  rows={[
                    { label: "Budget", value: money(p.budget), color: "var(--color-line-strong)" },
                    { label: "Earned value", value: money(p.ev), color: SERIES.earned },
                    { label: "Actual cost", value: money(p.ac), color: SERIES.actual },
                    { label: "Forecast", value: money(p.eac) },
                    { label: "CPI", value: cpi.toFixed(3) },
                  ]}
                />
              );
            }}
          />

          <Bar dataKey="budget" fill="var(--color-line-strong)" barSize={7} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          <Bar dataKey="ev" fill={SERIES.earned} barSize={7} radius={[0, 3, 3, 0]} isAnimationActive={false} />
          <Bar dataKey="ac" barSize={7} radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {rows.map((row) => (
              // Actual cost keeps its series colour; red is reserved for the
              // genuine exception of an account spent past its own budget.
              <Cell
                key={row.category}
                fill={row.ac > row.budget ? "var(--color-bad)" : SERIES.actual}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
