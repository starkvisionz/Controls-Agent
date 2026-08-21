"use client";

import type { Risk } from "@/lib/types";
import { money } from "@/lib/format";

/**
 * The 5×5 probability/impact matrix.
 *
 * Cell shading is an ordered severity ramp — green through amber to red as
 * probability × impact rises — not six arbitrary hues. The count sits in the
 * cell as a number, so severity is never carried by colour alone.
 */

const LEVELS = [1, 2, 3, 4, 5];

const IMPACT_LABELS = ["Insignificant", "Minor", "Moderate", "Major", "Severe"];
const PROBABILITY_LABELS = ["Rare", "Unlikely", "Possible", "Likely", "Almost certain"];

/** Ordered by severity so the ramp reads as one scale. */
function cellStyle(severity: number, count: number) {
  const band =
    severity >= 20 ? "extreme" : severity >= 12 ? "high" : severity >= 6 ? "medium" : "low";

  const base: Record<string, { bg: string; border: string; ink: string }> = {
    low: { bg: "var(--color-good-wash)", border: "color-mix(in srgb, var(--color-good) 25%, transparent)", ink: "var(--color-good)" },
    medium: { bg: "var(--color-warn-wash)", border: "color-mix(in srgb, var(--color-warn) 25%, transparent)", ink: "var(--color-warn)" },
    high: { bg: "color-mix(in srgb, var(--color-bad) 14%, var(--color-surface))", border: "color-mix(in srgb, var(--color-bad) 30%, transparent)", ink: "var(--color-bad)" },
    extreme: { bg: "color-mix(in srgb, var(--color-bad) 30%, var(--color-surface))", border: "var(--color-bad)", ink: "#ffdede" },
  };

  const tone = base[band];
  return {
    background: count > 0 ? tone.bg : "var(--color-surface)",
    borderColor: count > 0 ? tone.border : "var(--color-line)",
    color: count > 0 ? tone.ink : "var(--color-ink-faint)",
  };
}

export function RiskMatrix({
  risks,
  selectedCell,
  onSelectCell,
}: {
  risks: Risk[];
  selectedCell: { probability: number; impact: number } | null;
  onSelectCell: (cell: { probability: number; impact: number } | null) => void;
}) {
  const cells = new Map<string, Risk[]>();
  for (const risk of risks) {
    const key = `${risk.probability}-${risk.impact}`;
    cells.set(key, [...(cells.get(key) ?? []), risk]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {/* Probability axis label, rotated up the left edge. */}
        <div className="flex w-4 items-center justify-center">
          <span
            className="label whitespace-nowrap"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Probability
          </span>
        </div>

        <div className="flex-1">
          <div className="flex flex-col gap-1">
            {[...LEVELS].reverse().map((probability) => (
              <div key={probability} className="flex items-stretch gap-1">
                <div className="flex w-[86px] shrink-0 items-center justify-end pr-1">
                  <span className="truncate text-[10px] text-ink-faint" title={PROBABILITY_LABELS[probability - 1]}>
                    {probability} · {PROBABILITY_LABELS[probability - 1]}
                  </span>
                </div>

                {LEVELS.map((impact) => {
                  const list = cells.get(`${probability}-${impact}`) ?? [];
                  const severity = probability * impact;
                  const selected =
                    selectedCell?.probability === probability && selectedCell?.impact === impact;
                  const exposure = list.reduce((s, r) => s + r.expected_value, 0);

                  return (
                    <button
                      key={impact}
                      onClick={() =>
                        onSelectCell(selected || list.length === 0 ? null : { probability, impact })
                      }
                      disabled={list.length === 0}
                      title={
                        list.length === 0
                          ? `${PROBABILITY_LABELS[probability - 1]} × ${IMPACT_LABELS[impact - 1]} — no risks`
                          : `${list.length} risk${list.length === 1 ? "" : "s"} · severity ${severity} · ${money(exposure, { compact: true })} exposure\n` +
                            list.map((r) => `${r.code} ${r.title}`).join("\n")
                      }
                      style={cellStyle(severity, list.length)}
                      className={`flex h-11 flex-1 flex-col items-center justify-center rounded-sm border transition-all disabled:cursor-default ${
                        selected ? "ring-1 ring-accent" : list.length > 0 ? "hover:brightness-125" : ""
                      }`}
                    >
                      <span className="font-mono text-sm leading-none tabular">
                        {list.length || "·"}
                      </span>
                      {list.length > 0 ? (
                        <span className="mt-0.5 font-mono text-[9px] opacity-70 tabular">
                          {money(exposure, { compact: true })}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ))}

            {/* Impact axis */}
            <div className="flex gap-1">
              <div className="w-[86px] shrink-0" />
              {LEVELS.map((impact) => (
                <div key={impact} className="flex-1 pt-0.5 text-center">
                  <span className="text-[10px] text-ink-faint">
                    {impact} · {IMPACT_LABELS[impact - 1]}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-1">
              <div className="w-[86px] shrink-0" />
              <div className="label flex-1 text-center">Impact</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-5">
        {[
          { label: "Low (1–5)", severity: 4 },
          { label: "Medium (6–11)", severity: 8 },
          { label: "High (12–19)", severity: 15 },
          { label: "Extreme (20–25)", severity: 25 },
        ].map((band) => (
          <span key={band.label} className="flex items-center gap-1.5 text-[10px] text-ink-mute">
            <span
              className="h-2.5 w-2.5 rounded-sm border"
              style={cellStyle(band.severity, 1)}
            />
            {band.label}
          </span>
        ))}
      </div>
    </div>
  );
}
