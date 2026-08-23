"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, FileUp, X } from "lucide-react";
import { useProjects } from "@/components/shell/ProjectContext";
import { Badge, type Tone } from "@/components/ui/Badge";
import { ChangeList } from "@/components/activity/ChangeList";
import type { ImportPlan, PlannedRow, RowOutcome } from "@/lib/import/plan";

/**
 * Upload, look at what would happen, then decide.
 *
 * The file is posted twice: once for a preview and once to apply. The plan is
 * never sent back to the server — it re-derives it from the same file — so what
 * is shown here and what is written are the same computation rather than two
 * that are hoped to agree.
 *
 * Nothing is applied until the button under the preview is pressed. A register
 * import that writes on upload is a register import that ruins an afternoon.
 */

type Register = "tasks" | "risks" | "documents" | "change-orders";

type PreviewResponse = {
  format: string;
  fileName: string;
  meta?: Record<string, unknown>;
  plan: ImportPlan;
  result?: { applied: number; skipped: number };
};

const OUTCOME_TONE: Record<RowOutcome, Tone> = {
  update: "accent",
  unchanged: "neutral",
  "not-found": "warn",
  invalid: "bad",
};

const OUTCOME_LABEL: Record<RowOutcome, string> = {
  update: "will update",
  unchanged: "no change",
  "not-found": "not on this project",
  invalid: "rejected",
};

export function ImportDialog({
  register,
  label,
  onClose,
  onImported,
}: {
  register: Register;
  /** What the register is called, for the heading. */
  label: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const { activeProject } = useProjects();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [committed, setCommitted] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Refreshing the view is deferred to the dismissal, not done on the write.
   *
   * The button that opens this dialog lives in the register's toolbar, and
   * reloading the register swaps that whole view for its loading state — which
   * unmounts the toolbar, and this dialog with it. Committing would make the
   * result summary vanish in the same frame it was written. So the summary is
   * shown first, and the view catches up when it is dismissed.
   */
  const dismiss = () => {
    if (committed) onImported();
    onClose();
  };

  useEffect(() => {
    const escape = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  });

  const send = async (mode: "preview" | "commit", chosen: File) => {
    if (!activeProject) return;
    setBusy(mode);
    setError(null);

    try {
      const body = new FormData();
      body.append("file", chosen);
      const res = await fetch(
        `/api/projects/${activeProject.id}/import?register=${register}&mode=${mode}`,
        { method: "POST", body }
      );
      const payload = (await res.json().catch(() => ({}))) as PreviewResponse & { error?: string };

      if (!res.ok) {
        setError(payload.error ?? "That file could not be imported.");
        if (mode === "preview") setPreview(null);
        return;
      }

      if (mode === "preview") setPreview(payload);
      else setCommitted(payload);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  };

  const choose = (chosen: File | null) => {
    setFile(chosen);
    setPreview(null);
    setCommitted(null);
    setError(null);
    if (chosen) void send("preview", chosen);
  };

  const plan = committed?.plan ?? preview?.plan;
  const willApply = plan?.counts.update ?? 0;
  const problems = plan ? plan.counts.invalid + plan.counts["not-found"] : 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-dialog-title"
        className="flex max-h-[86vh] w-full max-w-[820px] flex-col rounded-panel border border-line-strong bg-overlay shadow-2xl shadow-black/60"
      >
        <div className="flex flex-none items-center justify-between border-b border-line px-3 py-2">
          <h2 id="import-dialog-title" className="text-2xs font-medium text-ink">
            Import {label.toLowerCase()}
          </h2>
          <button
            onClick={dismiss}
            aria-label="Close"
            className="flex h-5 w-5 items-center justify-center rounded-sm text-ink-faint transition-colors hover:text-ink-dim"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {/* Pick a file */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={busy !== null}
              className="flex h-8 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-2xs text-accent-hi transition-colors hover:bg-accent/15 disabled:opacity-50"
            >
              <FileUp className="h-3 w-3" />
              {file ? "Choose a different file" : "Choose a file"}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xer"
              className="hidden"
              onChange={(e) => choose(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <span className="truncate text-2xs text-ink-mute">
                {file.name}
                {preview ? <span className="ml-2 text-ink-faint">{preview.format}</span> : null}
              </span>
            ) : (
              <span className="text-2xs text-ink-faint">
                CSV, Excel, or a Primavera P6 XER export
              </span>
            )}
          </div>

          {busy === "preview" ? (
            <p className="mt-4 text-2xs text-ink-mute">Reading the file…</p>
          ) : null}

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-sm border border-bad/30 bg-bad-wash px-2.5 py-2">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0 text-bad" />
              <p className="text-2xs leading-relaxed text-bad">{error}</p>
            </div>
          ) : null}

          {plan ? (
            <>
              {/* What matched, and what did not */}
              <div className="mt-4 rounded-sm border border-line bg-raised px-2.5 py-2">
                <div className="label mb-1.5">Columns</div>
                <p className="text-[10px] leading-relaxed text-ink-mute">
                  {plan.mapped.map((m, i) => (
                    <span key={m.field}>
                      {i > 0 ? " · " : ""}
                      <span className="text-ink-dim">{m.column}</span>
                      <span className="text-ink-faint"> → {m.label}</span>
                    </span>
                  ))}
                </p>
                {plan.ignored.length > 0 ? (
                  <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">
                    Ignored: {plan.ignored.join(", ")}
                  </p>
                ) : null}
                {preview?.meta && typeof preview.meta.hoursPerDay === "number" ? (
                  <p className="mt-1 text-[10px] leading-relaxed text-warn">
                    P6 stores durations in hours; float has been converted at{" "}
                    {String(preview.meta.hoursPerDay)} hours to the day. A project on a different
                    calendar will read low.
                  </p>
                ) : null}
                {preview?.meta && Array.isArray(preview.meta.sheets) && preview.meta.sheets.length > 1 ? (
                  <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">
                    Read the first sheet, “{String(preview.meta.sheet)}”. This workbook also has:{" "}
                    {(preview.meta.sheets as string[]).slice(1).join(", ")}.
                  </p>
                ) : null}
              </div>

              {/* The counts */}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(Object.keys(plan.counts) as RowOutcome[])
                  .filter((k) => plan.counts[k] > 0)
                  .map((k) => (
                    <Badge key={k} tone={OUTCOME_TONE[k]}>
                      {plan.counts[k]} {OUTCOME_LABEL[k]}
                    </Badge>
                  ))}
              </div>

              {/* Row by row */}
              <div className="mt-3 max-h-[38vh] overflow-auto rounded-sm border border-line">
                <table className="w-full border-collapse text-2xs">
                  <thead className="sticky top-0 bg-chrome">
                    <tr className="border-b border-line-strong">
                      <th className="label px-2 py-1 text-left font-medium" style={{ width: "56px" }}>Line</th>
                      <th className="label px-2 py-1 text-left font-medium" style={{ width: "150px" }}>Record</th>
                      <th className="label px-2 py-1 text-left font-medium" style={{ width: "130px" }}>Outcome</th>
                      <th className="label px-2 py-1 text-left font-medium">What changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.rows.map((row) => (
                      <Row key={row.line} row={row} />
                    ))}
                  </tbody>
                </table>
              </div>

              {committed?.result ? (
                <>
                  <p className="mt-3 rounded-sm border border-good/30 bg-good-wash px-2.5 py-2 text-2xs text-good">
                    {committed.result.applied} record
                    {committed.result.applied === 1 ? "" : "s"} updated from {committed.fileName}
                    {committed.result.skipped > 0
                      ? `, ${committed.result.skipped} left alone`
                      : ""}
                    . Every one is in the activity log.
                  </p>
                  <button
                    onClick={dismiss}
                    className="mt-3 h-8 w-full rounded-sm bg-accent text-2xs font-medium text-black"
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  {problems > 0 ? (
                    <p className="mt-3 text-[10px] leading-relaxed text-ink-faint">
                      Rows that are rejected or not on this project are left alone — importing
                      applies only the {willApply} marked to update.
                    </p>
                  ) : null}

                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={dismiss}
                      className="h-8 flex-1 rounded-sm border border-line bg-raised text-2xs text-ink-mute transition-colors hover:text-ink-dim"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => file && send("commit", file)}
                      disabled={busy !== null || willApply === 0}
                      className="h-8 flex-[2] rounded-sm bg-accent text-2xs font-medium text-black disabled:bg-line disabled:text-ink-faint"
                    >
                      {busy === "commit"
                        ? "Importing…"
                        : willApply === 0
                          ? "Nothing to import"
                          : `Import ${willApply} change${willApply === 1 ? "" : "s"}`}
                    </button>
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ row }: { row: PlannedRow }) {
  return (
    <tr className="border-b border-line-soft last:border-b-0">
      <td className="px-2 py-1 font-mono text-ink-faint tabular">{row.line}</td>
      <td className="px-2 py-1 font-mono text-accent-hi">{row.label}</td>
      <td className="px-2 py-1">
        <Badge tone={OUTCOME_TONE[row.outcome]}>{OUTCOME_LABEL[row.outcome]}</Badge>
      </td>
      <td className="px-2 py-1 text-ink-mute">
        {row.errors.length > 0 ? (
          <span className="text-bad">
            {row.errors.map((e) => `${e.field} ${e.message}`).join("; ")}
          </span>
        ) : row.outcome === "not-found" ? (
          <span className="text-ink-faint">
            no record with this reference — check the file is for this project
          </span>
        ) : (
          <ChangeList changes={row.changes} />
        )}
      </td>
    </tr>
  );
}
