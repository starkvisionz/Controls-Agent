"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS, ChartFrame, CURSOR, GRID, Legend, SERIES, TooltipShell } from "./chart-theme";
import { money, monthLabel } from "@/lib/format";
import type { EvmPeriod } from "@/lib/types";

/**
 * The cost/schedule S-curve: cumulative planned value, earned value and actual
 * cost against one dollar axis, with the forecast continuing past the data date.
 *
 * All four series share a unit, so they share an axis — the gap between the
 * lines is the whole point of the chart and a second scale would erase it.
 */
export function SCurve({
  periods,
  dataDate,
  className = "",
}: {
  periods: EvmPeriod[];
  dataDate: string;
  className?: string;
}) {
  const rows = periods.map((p) => ({
    label: monthLabel(p.period_end),
    period: p.period_end,
    pv: p.planned_value,
    // Null past the data date so the actual lines stop rather than fall to zero.
    ev: p.is_forecast ? null : p.earned_value,
    ac: p.is_forecast ? null : p.actual_cost,
    forecast: p.forecast_value,
  }));

  const dataDateLabel = rows.find((r) => r.period >= dataDate)?.label;

  return (
    <ChartFrame
      title="S-curve — cumulative cost and value"
      subtitle="PV / EV / AC with forecast to completion"
      legend={
        <Legend
          items={[
            { label: "Planned value", color: SERIES.planned },
            { label: "Earned value", color: SERIES.earned },
            { label: "Actual cost", color: SERIES.actual },
            { label: "Forecast", color: SERIES.actual, dashed: true },
          ]}
        />
      }
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="pvFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES.planned} stopOpacity={0.16} />
              <stop offset="100%" stopColor={SERIES.planned} stopOpacity={0} />
            </linearGradient>
          </defs>

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

          {dataDateLabel ? (
            <ReferenceLine
              x={dataDateLabel}
              stroke="var(--color-ink-faint)"
              strokeDasharray="3 3"
              label={{
                value: "data date",
                position: "insideTopRight",
                fill: "var(--color-ink-faint)",
                fontSize: 9,
              }}
            />
          ) : null}

          <Tooltip
            cursor={CURSOR}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const point = payload[0].payload as (typeof rows)[number];
              const rows_: { label: string; value: string; color: string }[] = [
                { label: "Planned value", value: money(point.pv), color: SERIES.planned },
              ];
              if (point.ev !== null)
                rows_.push({ label: "Earned value", value: money(point.ev), color: SERIES.earned });
              if (point.ac !== null)
                rows_.push({ label: "Actual cost", value: money(point.ac), color: SERIES.actual });
              if (point.ev !== null && point.ac !== null) {
                rows_.push({ label: "SPI", value: (point.ev / point.pv || 0).toFixed(3), color: "" });
                rows_.push({ label: "CPI", value: (point.ev / point.ac || 0).toFixed(3), color: "" });
              }
              if (point.forecast !== null && point.ev === null)
                rows_.push({ label: "Forecast", value: money(point.forecast!), color: SERIES.actual });
              return <TooltipShell title={String(label)} rows={rows_} />;
            }}
          />

          <Area
            type="monotone"
            dataKey="pv"
            stroke={SERIES.planned}
            strokeWidth={2}
            fill="url(#pvFill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="forecast"
            stroke={SERIES.actual}
            strokeWidth={2}
            strokeDasharray="4 4"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ev"
            stroke={SERIES.earned}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="ac"
            stroke={SERIES.actual}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
