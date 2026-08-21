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
import type { ChangeOrderRow } from "@/lib/types";

/**
 * Which budgets change orders have actually moved.
 *
 * The obvious chart here is a bridge from the original budget to the current
 * one — and it is the wrong one. Approved change is under one percent of the
 * budget on a healthy job, so the steps of that bridge are invisible beside the
 * totals, and the only way to see them is to truncate the axis, which
 * exaggerates exactly the thing being measured. The totals are two numbers;
 * they read better as text.
 *
 * So this charts the movements at their own scale instead: net approved change
 * per control account, diverging around zero, largest movers first. That is
 * also the more useful question — not "did the budget move" but "whose budget
 * moved, and is anything still queued behind it".
 */
export function ChangeMovement({
  orders,
  limit = 10,
  className = "",
}: {
  orders: ChangeOrderRow[];
  limit?: number;
  className?: string;
}) {
  const byAccount = new Map<
    string,
    { code: string; name: string; approved: number; pending: number; count: number }
  >();

  for (const order of orders) {
    // An unallocated order has moved nothing and belongs to no bar.
    if (!order.cost_account_id || !order.account_code) continue;

    const row = byAccount.get(order.cost_account_id) ?? {
      code: order.account_code,
      name: order.account_name ?? order.account_code,
      approved: 0,
      pending: 0,
      count: 0,
    };
    if (order.status === "approved") row.approved += order.cost_impact;
    else if (order.status === "trend" || order.status === "submitted") {
      row.pending += order.cost_impact;
    }
    row.count += 1;
    byAccount.set(order.cost_account_id, row);
  }

  const rows = [...byAccount.values()]
    // Only accounts whose budget actually moved. An account carrying nothing
    // but an open trend would draw a zero-width bar — a row that looks like
    // missing data rather than the "no movement yet" it means.
    .filter((r) => r.approved !== 0)
    .sort((a, b) => Math.abs(b.approved) - Math.abs(a.approved))
    .slice(0, limit)
    .sort((a, b) => a.approved - b.approved);

  if (rows.length === 0) {
    return (
      <ChartFrame title="Change by control account" className={className}>
        <div className="flex h-full items-center justify-center text-2xs text-ink-faint">
          No approved change has moved a budget yet
        </div>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title="Change by control account"
      subtitle="net approved movement, largest first"
      legend={
        <Legend
          items={[
            { label: "Added", color: "var(--color-warn)" },
            { label: "Saved", color: "var(--color-good)" },
          ]}
        />
      }
      className={className}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 14, bottom: 0, left: 4 }}>
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

          {/* The neutral midpoint: the budget as originally estimated. */}
          <ReferenceLine x={0} stroke="var(--color-line-strong)" />

          <Tooltip
            cursor={{ fill: "var(--color-raised)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload as (typeof rows)[number];
              return (
                <TooltipShell
                  title={`${row.code} — ${row.name}`}
                  rows={[
                    {
                      label: "Approved",
                      value: money(row.approved, { sign: true }),
                      color: row.approved > 0 ? "var(--color-warn)" : "var(--color-good)",
                    },
                    // Pending is named but never drawn into the bar: it is not
                    // in this budget, and a mark would say that it is.
                    { label: "Still open", value: money(row.pending, { sign: true }) },
                    { label: "Orders", value: String(row.count) },
                  ]}
                />
              );
            }}
          />

          <Bar dataKey="approved" barSize={9} radius={2} isAnimationActive={false}>
            {rows.map((row) => (
              <Cell
                key={row.code}
                fill={row.approved > 0 ? "var(--color-warn)" : "var(--color-good)"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
