"use client";

import { useProjects } from "./ProjectContext";
import { index, money, percent, shortDate } from "@/lib/format";
import { indexTone } from "@/lib/format";

const TONE_CLASS = { good: "text-good", warn: "text-warn", bad: "text-bad" } as const;

/** The 22px readout strip along the bottom of the window. */
export function StatusBar({ agentSource }: { agentSource: "claude" | "local" | null }) {
  const { activeProject } = useProjects();

  if (!activeProject) {
    return (
      <footer className="flex h-[22px] flex-none items-center border-t border-line bg-chrome px-3 text-[10px] text-ink-faint">
        No project loaded
      </footer>
    );
  }

  const m = activeProject.metrics;
  const late = m.scheduleVarianceDays;

  return (
    <footer className="flex h-[22px] flex-none items-center gap-4 border-t border-line bg-chrome px-3 font-mono text-[10px] text-ink-mute tabular">
      <span className="text-accent-hi">{activeProject.code}</span>
      <Field label="SPI" value={index(m.spi)} className={TONE_CLASS[indexTone(m.spi)]} />
      <Field label="CPI" value={index(m.cpi)} className={TONE_CLASS[indexTone(m.cpi)]} />
      <Field label="EV" value={money(m.ev, { compact: true })} />
      <Field label="EAC" value={money(m.eac, { compact: true })} />
      <Field
        label="VAC"
        value={money(m.vac, { sign: true, compact: true })}
        className={m.vac < 0 ? "text-bad" : "text-good"}
      />
      <Field label="Complete" value={percent(m.percentComplete, 1)} />
      <Field
        label="Finish"
        value={shortDate(activeProject.forecast_finish)}
        className={late > 0 ? "text-bad" : "text-good"}
      />
      <span className={late > 0 ? "text-bad" : "text-good"}>
        {late === 0 ? "on baseline" : `${Math.abs(late)}d ${late > 0 ? "late" : "early"}`}
      </span>

      <span className="ml-auto flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            agentSource === "claude" ? "bg-good" : agentSource === "local" ? "bg-warn" : "bg-ink-faint"
          }`}
        />
        {agentSource === "claude"
          ? "Agent: Claude API"
          : agentSource === "local"
            ? "Agent: local analyst"
            : "Agent: idle"}
      </span>
    </footer>
  );
}

function Field({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <span className="text-ink-faint">{label}</span>
      <span className={className || "text-ink-dim"}>{value}</span>
    </span>
  );
}
