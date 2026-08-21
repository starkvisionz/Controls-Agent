"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/Badge";
import { ReadOnlyNote } from "@/components/ui/Controls";
import { useSession } from "@/components/shell/SessionContext";
import { ROLE_LABELS } from "@/lib/rbac";
import { Meter } from "@/components/ui/Stat";
import { money, severityBand, shortDate } from "@/lib/format";
import type { Risk } from "@/lib/types";

const BAND_TONE: Record<string, Tone> = {
  low: "good",
  medium: "warn",
  high: "bad",
  extreme: "bad",
};

const STATUSES = ["open", "mitigating", "monitoring", "closed", "realised"];
const STRATEGIES = ["Avoid", "Transfer", "Mitigate", "Accept", "Exploit"];

/** Risk inspector — status, scoring and mitigation progress are all writable. */
export function RiskDetail({
  risk,
  onClose,
  onSaved,
}: {
  risk: Risk;
  onClose: () => void;
  onSaved: (risk: Risk) => void;
}) {
  // Initialised from the risk and never re-synced: the caller remounts this
  // component per risk (`key={risk.id}`), which is React's own answer to
  // resetting form state on a prop change and avoids a second render pass.
  const { can, role } = useSession();
  const editable = can("risk:write", risk.project_id);

  const [status, setStatus] = useState(risk.status);
  const [probability, setProbability] = useState(risk.probability);
  const [impact, setImpact] = useState(risk.impact);
  const [progress, setProgress] = useState(risk.mitigation_progress);
  const [strategy, setStrategy] = useState(risk.response_strategy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    status !== risk.status ||
    probability !== risk.probability ||
    impact !== risk.impact ||
    progress !== risk.mitigation_progress ||
    strategy !== risk.response_strategy;

  const severity = probability * impact;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/risks/${risk.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          probability,
          impact,
          mitigation_progress: progress,
          response_strategy: strategy,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
      const json = (await res.json()) as { risk: Risk };
      onSaved(json.risk);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="flex w-[320px] flex-none flex-col border-l border-line bg-surface">
      <header className="panel-head">
        <h3 className="text-2xs font-medium text-ink-dim">{risk.code}</h3>
        <Badge tone={risk.risk_type === "opportunity" ? "good" : BAND_TONE[severityBand(severity)]}>
          {severityBand(severity)}
        </Badge>
        <button
          onClick={onClose}
          aria-label="Close risk detail"
          className="ml-auto text-ink-faint hover:text-ink-dim"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <h4 className="text-xs leading-snug text-ink">{risk.title}</h4>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge>{risk.category}</Badge>
          <Badge tone={risk.risk_type === "opportunity" ? "good" : "neutral"}>{risk.risk_type}</Badge>
        </div>

        <p className="mt-3 text-2xs leading-relaxed text-ink-mute">{risk.description}</p>

        <dl className="mt-4 flex flex-col gap-2 border-t border-line pt-3">
          <Field label="Owner" value={risk.owner} />
          <Field label="Identified" value={shortDate(risk.identified_date)} />
          <Field label="Next review" value={shortDate(risk.review_date)} />
          <Field label="Worst-case cost" value={money(risk.cost_impact)} tone="bad" />
          <Field label="Schedule impact" value={`${risk.schedule_impact_days} days`} />
          <Field label="Expected value" value={money(risk.expected_value)} />
          <Field
            label="Residual score"
            value={
              risk.residual_probability && risk.residual_impact
                ? `${risk.residual_probability} × ${risk.residual_impact} = ${risk.residual_probability * risk.residual_impact}`
                : "—"
            }
          />
        </dl>

        <div className="mt-3 border-t border-line pt-3">
          <div className="label mb-1.5">Mitigation plan</div>
          <p className="text-2xs leading-relaxed text-ink-mute">{risk.mitigation_plan}</p>
        </div>

        <fieldset className="mt-4 border-t border-line pt-3" disabled={!editable}>
          <div className="label mb-2">Assessment</div>

          {!editable ? <ReadOnlyNote what="the risk register" role={ROLE_LABELS[role]} /> : null}

          <ScoreRow label="Probability" value={probability} onChange={setProbability} />
          <ScoreRow label="Impact" value={impact} onChange={setImpact} />

          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-2xs text-ink-mute">Severity</span>
            <span className="font-mono text-2xs text-ink tabular">
              {probability} × {impact} = {severity}
            </span>
          </div>

          <div className="mb-1 mt-3 flex items-center justify-between">
            <span className="text-2xs text-ink-mute">Mitigation progress</span>
            <span className="font-mono text-2xs text-ink tabular">{progress}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-line accent-[var(--color-accent)]"
          />
          <Meter value={progress} tone={progress >= 75 ? "good" : progress >= 30 ? "warn" : "bad"} className="mt-2" />

          <div className="label mb-1 mt-3">Response</div>
          <div className="flex flex-wrap gap-1">
            {STRATEGIES.map((s) => (
              <Chip key={s} active={strategy === s} onClick={() => setStrategy(s)}>
                {s}
              </Chip>
            ))}
          </div>

          <div className="label mb-1 mt-3">Status</div>
          <div className="flex flex-wrap gap-1">
            {STATUSES.map((s) => (
              <Chip key={s} active={status === s} onClick={() => setStatus(s)}>
                {s}
              </Chip>
            ))}
          </div>

          {error ? <p className="mt-2 text-2xs text-bad">{error}</p> : null}

          <button
            onClick={save}
            disabled={!dirty || saving}
            className="mt-3 w-full rounded-sm bg-accent px-2 py-1.5 text-2xs font-medium text-black transition-opacity disabled:bg-line disabled:text-ink-faint"
          >
            {saving ? "Saving…" : dirty ? "Save assessment" : "No changes"}
          </button>
        </fieldset>
      </div>
    </aside>
  );
}

function ScoreRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <span className="w-16 shrink-0 text-2xs text-ink-mute">{label}</span>
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            onClick={() => onChange(n)}
            className={`flex-1 rounded-sm border py-0.5 font-mono text-[10px] tabular transition-colors ${
              value === n
                ? "border-accent/50 bg-accent/10 text-accent-hi"
                : "border-line bg-raised text-ink-faint hover:text-ink-mute"
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wide transition-colors ${
        active
          ? "border-accent/50 bg-accent/10 text-accent-hi"
          : "border-line bg-raised text-ink-mute hover:text-ink-dim"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, value, tone = "neutral" }: { label: string; value: string; tone?: Tone }) {
  const color = tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : "text-ink-dim";
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="label shrink-0">{label}</dt>
      <dd className={`truncate text-right font-mono text-2xs tabular ${color}`}>{value}</dd>
    </div>
  );
}
