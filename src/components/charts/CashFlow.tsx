"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS, ChartFrame, CURSOR, GRID, Legend, SERIES, TooltipShell } from "./chart-theme";
import { money, monthLabel } from "@/lib/format";
import type { EvmPeriod } from "@/lib/types";

/**
 * Spend and value earned within each period.
 *
 * Cumulative cost deliberately lives on the dashboard S-curve instead of here:
 * a cumulative line is two orders of magnitude taller than a monthly bar, and
 * putting both on one axis flattens the bars into nothing. Two questions, two
 * charts — not one chart with two scales.
 */
export function CashFlow({
  periods,
  className = "",
}: {
  periods: EvmPeriod[];
  className?: string;
}) {
  const actuals = periods.filter((p) => !p.is_forecast);

  const rows = actuals.map((p, i) => {
    const prior = i > 0 ? actuals[i - 1] : null;
    const spend = Math.max(p.actual_cost - (prior?.actual_cost ?? 0), 0);
    const earned = Math.max(p.earned_value - (prior?.earned_value ?? 0), 0);
    return { label: monthLabel(p.period_end), spend, earned, net: earned - spend };
  });

  return (
    <ChartFrame
      title="Cash flow by period"
      subtitle="spend against value earned, each month"
      legend={
        <Legend
          items={[
            { label: "Spend", color: SERIES.actual },
            { label: "Value earned", color: SERIES.earned },
          ]}
        />
      }
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 4 }} barGap={2}>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis
            dataKey="label"
            stroke={AXIS.stroke}
            tick={AXIS.tick}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            stroke={AXIS.stroke}
            tick={AXIS.tick}
            tickLine={false}
            axisLine={false}
            width={46}
            tickFormatter={(v: number) => money(v, { compact: true })}
          />

          <Tooltip
            cursor={CURSOR}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof rows)[number];
              return (
                <TooltipShell
                  title={String(label)}
                  rows={[
                    { label: "Spend", value: money(p.spend), color: SERIES.actual },
                    { label: "Value earned", value: money(p.earned), color: SERIES.earned },
                    { label: "Net", value: money(p.net, { sign: true }) },
                  ]}
                />
              );
            }}
          />

          <Bar dataKey="spend" fill={SERIES.actual} barSize={5} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="earned" fill={SERIES.earned} barSize={5} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
