"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Stat";
import { daysBetween, money, shortDate } from "@/lib/format";
import type { Task } from "@/lib/types";

const STATUS_TONE: Record<Task["status"], Tone> = {
  complete: "good",
  "in-progress": "accent",
  blocked: "bad",
  "not-started": "neutral",
};

const STATUSES: Task["status"][] = ["not-started", "in-progress", "blocked", "complete"];

/**
 * Activity inspector. Progress and status are writable — they are the two
 * fields a controls engineer actually updates during a progress review.
 */
export function TaskDetail({
  task,
  onClose,
  onSaved,
}: {
  task: Task;
  onClose: () => void;
  onSaved: (task: Task) => void;
}) {
  // Initialised from the task and never re-synced: the caller remounts this
  // component per activity (`key={task.id}`), which is React's own answer to
  // resetting form state on a prop change and avoids a second render pass.
  const [percent, setPercent] = useState(task.percent_complete);
  const [status, setStatus] = useState<Task["status"]>(task.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = percent !== task.percent_complete || status !== task.status;
  const slip = daysBetween(task.baseline_finish, task.forecast_finish);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ percent_complete: percent, status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
      const json = (await res.json()) as { task: Task };
      onSaved(json.task);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="flex w-[300px] flex-none flex-col border-l border-line bg-surface">
      <header className="panel-head">
        <h3 className="truncate text-2xs font-medium text-ink-dim">{task.code}</h3>
        <button
          onClick={onClose}
          aria-label="Close activity detail"
          className="ml-auto text-ink-faint hover:text-ink-dim"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <h4 className="text-xs leading-snug text-ink">{task.name}</h4>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge tone={STATUS_TONE[task.status]}>{task.status.replace("-", " ")}</Badge>
          {task.is_critical ? <Badge tone="bad">critical</Badge> : null}
          {task.is_milestone ? <Badge tone="info">milestone</Badge> : null}
          <Badge>{task.discipline}</Badge>
        </div>

        <dl className="mt-4 flex flex-col gap-2">
          <Field label="Responsible" value={task.responsible} />
          <Field label="Baseline" value={`${shortDate(task.baseline_start)} → ${shortDate(task.baseline_finish)}`} />
          <Field label="Forecast" value={`${shortDate(task.forecast_start)} → ${shortDate(task.forecast_finish)}`} />
          <Field
            label="Variance"
            value={slip === 0 ? "on baseline" : `${slip > 0 ? "+" : ""}${slip} days`}
            tone={slip > 0 ? "bad" : slip < 0 ? "good" : "neutral"}
          />
          <Field label="Duration" value={`${task.duration_days} days`} />
          <Field
            label="Total float"
            value={`${task.total_float_days} days`}
            tone={task.total_float_days <= 0 ? "bad" : task.total_float_days < 10 ? "warn" : "neutral"}
          />
          <Field label="Budget" value={money(task.budget)} />
          <Field label="Earned value" value={money(task.earned_value)} />
          <Field label="Actual cost" value={money(task.actual_cost)} />
          {task.predecessors ? <Field label="Predecessors" value={task.predecessors} /> : null}
        </dl>

        {task.notes ? (
          <p className="mt-3 rounded-sm border border-warn/25 bg-warn-wash px-2 py-1.5 text-2xs text-warn">
            {task.notes}
          </p>
        ) : null}

        <div className="mt-4 border-t border-line pt-3">
          <div className="label mb-2">Update progress</div>

          {/* Hermes stores the network but does not solve it. Saying so beats
              letting a planner assume successors moved when they did not. */}
          <p className="mb-3 rounded-sm border border-line bg-raised px-2 py-1.5 text-[10px] leading-relaxed text-ink-mute">
            Progress updates flow through to earned value and the project&apos;s cost
            performance. They do <strong className="text-ink-dim">not</strong> re-run the
            network: successor dates, total float and the critical path stay as imported
            until the source schedule is republished.
          </p>

          <div className="mb-1 flex items-center justify-between">
            <span className="text-2xs text-ink-mute">Percent complete</span>
            <span className="font-mono text-2xs text-ink tabular">{percent}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={percent}
            onChange={(e) => setPercent(Number(e.target.value))}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-line accent-[var(--color-accent)]"
          />
          <Meter value={percent} tone="accent" className="mt-2" />

          <div className="mt-3 grid grid-cols-2 gap-1">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-sm border px-1.5 py-1 text-[10px] uppercase tracking-wide transition-colors ${
                  status === s
                    ? "border-accent/50 bg-accent/10 text-accent-hi"
                    : "border-line bg-raised text-ink-mute hover:text-ink-dim"
                }`}
              >
                {s.replace("-", " ")}
              </button>
            ))}
          </div>

          {error ? <p className="mt-2 text-2xs text-bad">{error}</p> : null}

          <button
            onClick={save}
            disabled={!dirty || saving}
            className="mt-3 w-full rounded-sm bg-accent px-2 py-1.5 text-2xs font-medium text-black transition-opacity disabled:bg-line disabled:text-ink-faint"
          >
            {saving ? "Saving…" : dirty ? "Save progress" : "No changes"}
          </button>
        </div>
      </div>
    </aside>
  );
}

function Field({ label, value, tone = "neutral" }: { label: string; value: string; tone?: Tone }) {
  const color =
    tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-ink-dim";
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="label shrink-0">{label}</dt>
      <dd className={`truncate text-right font-mono text-2xs tabular ${color}`} title={value}>
        {value}
      </dd>
    </div>
  );
}
