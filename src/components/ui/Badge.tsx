import type { ReactNode } from "react";

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "border-line-strong bg-raised text-ink-dim",
  good: "border-good/30 bg-good-wash text-good",
  warn: "border-warn/30 bg-warn-wash text-warn",
  bad: "border-bad/30 bg-bad-wash text-bad",
  info: "border-info/30 bg-info-wash text-info",
  accent: "border-accent/30 bg-accent-wash text-accent-hi",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** A coloured dot for dense tables where a full badge would be too heavy. */
export function Dot({ tone = "neutral" }: { tone?: Tone }) {
  const colors: Record<Tone, string> = {
    neutral: "bg-neutral",
    good: "bg-good",
    warn: "bg-warn",
    bad: "bg-bad",
    info: "bg-info",
    accent: "bg-accent",
  };
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${colors[tone]}`} />;
}
