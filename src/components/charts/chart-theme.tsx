"use client";

import type { ReactNode } from "react";

/**
 * Shared chart chrome.
 *
 * Every chart in the app draws from the same token set so a colour means the
 * same thing wherever it appears: earned value is always green, actual cost is
 * always orange, planned value is always blue.
 */
export const SERIES = {
  actual: "var(--color-series-1)",
  planned: "var(--color-series-2)",
  earned: "var(--color-series-3)",
  four: "var(--color-series-4)",
  five: "var(--color-series-5)",
  six: "var(--color-series-6)",
} as const;

export const CATEGORICAL = [
  "var(--color-series-1)",
  "var(--color-series-2)",
  "var(--color-series-3)",
  "var(--color-series-4)",
  "var(--color-series-5)",
  "var(--color-series-6)",
];

export const AXIS = {
  stroke: "var(--color-line-strong)",
  tick: { fill: "var(--color-ink-mute)", fontSize: 10 },
};

export const GRID = {
  stroke: "var(--color-line-soft)",
  strokeDasharray: "2 4",
} as const;

/** Chart cursor used by every tooltip, so hover feels identical everywhere. */
export const CURSOR = { stroke: "var(--color-line-strong)", strokeWidth: 1 };

type TooltipRow = { label: string; value: string; color?: string };

/** The one tooltip shell. Text stays in ink tokens; colour rides the swatch. */
export function TooltipShell({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="rounded-panel border border-line-strong bg-overlay px-2.5 py-2 shadow-xl shadow-black/60">
      <div className="label mb-1.5">{title}</div>
      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 text-2xs">
            {row.color ? (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: row.color }}
              />
            ) : null}
            <span className="text-ink-mute">{row.label}</span>
            <span className="ml-auto font-mono text-ink tabular">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Legend rendered as plain markup — Recharts' default is too loud for this UI. */
export function Legend({
  items,
}: {
  items: { label: string; color: string; dashed?: boolean }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-2xs text-ink-mute">
          <span
            className="h-0.5 w-3 shrink-0 rounded-full"
            style={
              item.dashed
                ? {
                    backgroundImage: `repeating-linear-gradient(to right, ${item.color} 0 3px, transparent 3px 6px)`,
                  }
                : { background: item.color }
            }
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** Titled chart container with a legend slot above the plot. */
export function ChartFrame({
  title,
  subtitle,
  legend,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel flex min-h-0 flex-col p-3 ${className}`}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h3 className="text-2xs font-medium text-ink-dim">{title}</h3>
          {subtitle ? <span className="text-[10px] text-ink-faint">{subtitle}</span> : null}
        </div>
        {legend}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}
