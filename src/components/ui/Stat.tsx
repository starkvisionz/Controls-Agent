import type { ReactNode } from "react";
import type { Tone } from "./Badge";

const VALUE_TONE: Record<Tone, string> = {
  neutral: "text-ink",
  good: "text-good",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-info",
  accent: "text-accent-hi",
};

/**
 * A KPI tile: label, one large figure, and a single line of context beneath.
 * Never more than one number at full size — the eye should land in one place.
 */
export function Stat({
  label,
  value,
  tone = "neutral",
  context,
  icon,
  spark,
}: {
  label: string;
  value: string;
  tone?: Tone;
  context?: ReactNode;
  icon?: ReactNode;
  /** Optional right-hand visual, e.g. a mini bar or gauge. */
  spark?: ReactNode;
}) {
  return (
    <div className="panel flex min-w-0 flex-col gap-1.5 p-3">
      <div className="flex items-center gap-1.5">
        {icon ? <span className="text-ink-faint [&>svg]:h-3 [&>svg]:w-3">{icon}</span> : null}
        <span className="label truncate">{label}</span>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className={`font-mono text-xl leading-none tabular ${VALUE_TONE[tone]}`}>{value}</span>
        {spark ? <div className="shrink-0">{spark}</div> : null}
      </div>
      {context ? <div className="truncate text-2xs text-ink-mute">{context}</div> : null}
    </div>
  );
}

/** Horizontal meter used inside stat tiles and tables. */
export function Meter({
  value,
  max = 100,
  tone = "accent",
  className = "",
}: {
  value: number;
  max?: number;
  tone?: Tone;
  className?: string;
}) {
  const colors: Record<Tone, string> = {
    neutral: "bg-neutral",
    good: "bg-good",
    warn: "bg-warn",
    bad: "bg-bad",
    info: "bg-info",
    accent: "bg-accent",
  };
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`h-1 w-full overflow-hidden rounded-full bg-line ${className}`}>
      <div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
