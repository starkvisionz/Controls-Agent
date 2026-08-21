"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS, ChartFrame, CURSOR, GRID, Legend, SERIES, TooltipShell } from "./chart-theme";
import { monthLabel } from "@/lib/format";
import type { EvmPeriod } from "@/lib/types";

/**
 * SPI and CPI over time. Both are dimensionless ratios around 1.0, so they
 * legitimately share one axis — the 1.0 reference line is the reading.
 */
export function IndexTrend({
  periods,
  className = "",
}: {
  periods: EvmPeriod[];
  className?: string;
}) {
  const rows = periods
    .filter((p) => !p.is_forecast && p.planned_value > 0 && p.actual_cost > 0)
    .map((p) => ({
      label: monthLabel(p.period_end),
      spi: p.earned_value / p.planned_value,
      cpi: p.earned_value / p.actual_cost,
    }));

  const values = rows.flatMap((r) => [r.spi, r.cpi]);
  const lo = Math.min(0.9, ...values) - 0.02;
  const hi = Math.max(1.1, ...values) + 0.02;

  return (
    <ChartFrame
      title="Performance indices"
      subtitle="SPI and CPI by period"
      legend={
        <Legend
          items={[
            { label: "SPI", color: SERIES.planned },
            { label: "CPI", color: SERIES.actual },
          ]}
        />
      }
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
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
            width={34}
            domain={[lo, hi]}
            tickFormatter={(v: number) => v.toFixed(2)}
          />

          {/* Parity: above this line is favourable, below is not. */}
          <ReferenceLine y={1} stroke="var(--color-ink-faint)" strokeDasharray="3 3" />

          <Tooltip
            cursor={CURSOR}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as (typeof rows)[number];
              return (
                <TooltipShell
                  title={String(label)}
                  rows={[
                    { label: "SPI", value: p.spi.toFixed(3), color: SERIES.planned },
                    { label: "CPI", value: p.cpi.toFixed(3), color: SERIES.actual },
                  ]}
                />
              );
            }}
          />

          <Line
            type="monotone"
            dataKey="spi"
            stroke={SERIES.planned}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="cpi"
            stroke={SERIES.actual}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
