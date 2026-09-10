/**
 * Primavera P6 XER, which is tab-delimited text rather than XML.
 *
 * The structure is four record markers, one per line, each field tab-separated:
 *
 *   ERMHDR   the file header — version, export date, currency
 *   %T       the table that follows
 *   %F       that table's field names
 *   %R       a row of it
 *   %E       end of file
 *
 * Parsed here rather than with a library because the format is this small, and
 * because the alternative packages are thin wrappers that would still need the
 * P6-to-Starkvisionz field mapping written by hand.
 *
 * What is taken from it: TASK (activities, dates, float, percent complete) and
 * PROJWBS (the breakdown structure). P6 exports carry thirty-odd other tables —
 * resources, calendars, codes — which are read past rather than imported,
 * because a register this app has no column for is a register it cannot keep
 * consistent.
 */

import { MAX_ROWS, TooLargeError } from "./csv";

export type XerTable = { name: string; fields: string[]; rows: Record<string, string>[] };

export type XerFile = {
  version: string;
  exportedAt: string;
  tables: Map<string, XerTable>;
};

/** Tables worth reading. Everything else is skipped without being buffered. */
const WANTED = new Set(["TASK", "PROJWBS", "PROJECT", "TASKPRED"]);

export function parseXer(text: string): XerFile {
  const lines = text.split(/\r?\n/);

  let version = "";
  let exportedAt = "";
  const tables = new Map<string, XerTable>();

  let current: XerTable | null = null;
  let keeping = false;
  let rowCount = 0;

  for (const line of lines) {
    if (line === "") continue;

    const parts = line.split("\t");
    const marker = parts[0];

    if (marker === "ERMHDR") {
      // ERMHDR <version> <date> <project> <user> <db> ...
      version = parts[1] ?? "";
      exportedAt = parts[2] ?? "";
      continue;
    }

    if (marker === "%T") {
      const name = parts[1] ?? "";
      keeping = WANTED.has(name);
      current = keeping ? { name, fields: [], rows: [] } : null;
      if (current) tables.set(name, current);
      continue;
    }

    if (marker === "%F") {
      if (current) current.fields = parts.slice(1);
      continue;
    }

    if (marker === "%R") {
      if (!current) continue;
      const values = parts.slice(1);
      const row: Record<string, string> = {};
      current.fields.forEach((field, i) => {
        row[field] = values[i] ?? "";
      });
      current.rows.push(row);

      rowCount++;
      if (rowCount > MAX_ROWS) {
        throw new TooLargeError(`That XER holds more than ${MAX_ROWS} rows across its tables`);
      }
      continue;
    }

    if (marker === "%E") break;
  }

  if (!tables.has("TASK") && !tables.has("PROJWBS")) {
    throw new Error(
      "That file has no TASK or PROJWBS table. Export it from P6 as an XER including activities."
    );
  }

  return { version, exportedAt, tables };
}

/**
 * P6 dates are `YYYY-MM-DD HH:MM` — the time is noise for a register that works
 * in whole days, and the schemas want a bare calendar date.
 */
export function xerDate(value: string): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  return match ? match[1] : null;
}

/**
 * P6 stores durations and float in hours against the activity's calendar.
 *
 * Converted at eight hours to the day, which is the default P6 ships with. A
 * project on a ten-hour calendar will read low, so the importer reports the
 * assumption rather than hiding it.
 */
export const HOURS_PER_DAY = 8;

export function xerDays(value: string): number {
  const hours = Number((value ?? "").trim());
  if (!Number.isFinite(hours)) return 0;
  return Math.round(hours / HOURS_PER_DAY);
}

/** P6 `complete_pct_type` decides which of three percent fields is the real one. */
export function xerPercent(row: Record<string, string>): number {
  const type = row.complete_pct_type ?? "";
  const field =
    type === "CP_Phys" ? "phys_complete_pct"
    : type === "CP_Units" ? "act_work_qty"
    : "remain_drtn_hr_cnt";

  if (field === "phys_complete_pct") {
    const pct = Number(row.phys_complete_pct ?? "");
    return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  }

  // Duration percent: how much of the planned duration is no longer remaining.
  const remaining = Number(row.remain_drtn_hr_cnt ?? "");
  const target = Number(row.target_drtn_hr_cnt ?? "");
  if (!Number.isFinite(remaining) || !Number.isFinite(target) || target <= 0) {
    return row.status_code === "TK_Complete" ? 100 : 0;
  }
  return Math.max(0, Math.min(100, Math.round(((target - remaining) / target) * 100)));
}

/** P6 status codes to the four this app uses. */
export function xerStatus(code: string): "not-started" | "in-progress" | "complete" {
  if (code === "TK_Complete") return "complete";
  if (code === "TK_Active") return "in-progress";
  return "not-started";
}
