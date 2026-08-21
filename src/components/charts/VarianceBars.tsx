"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS, ChartFrame, GRID, Legend, TooltipShell } from "./chart-theme";
import { money } from "@/lib/format";
import type { CostAccount } from "@/lib/types";

/**
 * Variance at completion by control account — a diverging chart around zero.
 * Two hues either side of a neutral baseline: favourable variance reads green,
 * overrun reads red, and the zero rule is where the budget sits.
 */
export function VarianceBars({
  accounts,
  limit = 12,
  className = "",
}: {
  accounts: CostAccount[];
  limit?: number;
  className?: string;
}) {
  const rows = [...accounts]
    .map((a) => ({
      code: a.code,
      name: a.name,
      vac: a.current_budget - a.forecast_at_completion,
      budget: a.current_budget,
      eac: a.forecast_at_completion,
      cpi: a.actual_cost > 0 ? a.earned_value / a.actual_cost : 1,
    }))
    // Largest movers in either direction, then ordered worst to best.
    .sort((a, b) => Math.abs(b.vac) - Math.abs(a.vac))
    .slice(0, limit)
    .sort((a, b) => a.vac - b.vac);

  return (
    <ChartFrame
      title="Variance at completion"
      subtitle="by control account"
      legend={
        <Legend
          items={[
            { label: "Overrun", color: "var(--color-bad)" },
            { label: "Underrun", color: "var(--color-good)" },
          ]}
        />
      }
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis
            type="number"
            stroke={AXIS.stroke}
            tick={AXIS.tick}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => money(v, { compact: true, sign: true })}
          />
          <YAxis
            type="category"
            dataKey="code"
            stroke={AXIS.stroke}
            tick={AXIS.tick}
            tickLine={false}
            axisLine={false}
            width={62}
          />

          {/* The neutral midpoint: on budget. */}
          <ReferenceLine x={0} stroke="var(--color-line-strong)" />

          <Tooltip
            cursor={{ fill: "var(--color-raised)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof rows)[number];
              return (
                <TooltipShell
                  title={`${p.code} — ${p.name}`}
                  rows={[
                    { label: "Budget", value: money(p.budget) },
                    { label: "Forecast", value: money(p.eac) },
                    {
                      label: "Variance",
                      value: money(p.vac, { sign: true }),
                      color: p.vac < 0 ? "var(--color-bad)" : "var(--color-good)",
                    },
                    { label: "CPI", value: p.cpi.toFixed(3) },
                  ]}
                />
              );
            }}
          />

          <Bar dataKey="vac" barSize={9} radius={2} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell
                key={row.code}
                fill={row.vac < 0 ? "var(--color-bad)" : "var(--color-good)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
