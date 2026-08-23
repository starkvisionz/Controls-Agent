"use client";

import type { FieldChange } from "@/lib/audit";

/**
 * Shared between the Activity view and the history strip in the inspectors, so
 * a change reads the same wherever it is shown.
 */

const FIELD_LABEL: Record<string, string> = {
  percent_complete: "progress",
  cost_impact: "value",
  schedule_impact_days: "schedule impact",
  cost_account_id: "allocation",
  decision_date: "decided",
  submitted_date: "submitted",
  forecast_start: "forecast start",
  forecast_finish: "forecast finish",
  mitigation_progress: "mitigation",
  review_status: "review",
  is_active: "active",
  role: "role",
  projects: "project access",
};

const ACTION_LABEL: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
  create: "created",
  update: "updated",
  disable: "disabled",
  enable: "enabled",
  "reset-password": "password",
  "sign-in": "signed in",
};

export function describeAction(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/** A value as it should read in a log line. */
function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    // Money is the only thing here big enough to need separators, and a
    // percentage is the only thing small enough to want a decimal.
    if (Math.abs(value) >= 10_000) return Math.round(value).toLocaleString();
    return String(Math.round(value * 100) / 100);
  }
  const text = String(value);
  return text.length > 42 ? `${text.slice(0, 41)}…` : text;
}

export function ChangeList({ changes }: { changes: FieldChange[] }) {
  if (changes.length === 0) {
    return <span className="text-ink-faint">—</span>;
  }

  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {changes.map((c) => (
        <span key={c.field} className="whitespace-nowrap">
          <span className="text-ink-faint">{FIELD_LABEL[c.field] ?? c.field.replace(/_/g, " ")}</span>{" "}
          <span className="font-mono text-2xs text-ink-faint line-through">{show(c.from)}</span>
          <span className="mx-1 text-ink-faint">→</span>
          <span className="font-mono text-2xs text-ink-dim">{show(c.to)}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Relative for anything recent, absolute once it stops being "the other day".
 * A controls log is read both ways — "who just did that" and "what happened in
 * March" — and one format cannot serve both.
 */
export function when(at: string): string {
  // SQLite's datetime('now') is UTC without a zone marker; say so explicitly or
  // the browser reads it as local and every entry looks hours out.
  const then = new Date(`${at.replace(" ", "T")}Z`);
  if (Number.isNaN(then.getTime())) return at;

  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 60 * 24 * 6) return `${Math.round(minutes / (60 * 24))}d ago`;

  return then.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: then.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}
