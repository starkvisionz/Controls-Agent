import { parseXer, xerDate, xerDays, xerPercent, xerStatus, HOURS_PER_DAY } from "./xer";

/**
 * A P6 export, reduced to the same table shape a spreadsheet parses to.
 *
 * The point of going through the same planner is that a schedule refresh gets
 * the same preview, the same validation and the same audit entries as a
 * progress spreadsheet. P6 is a data source, not a second import mechanism.
 *
 * Matching is on Activity ID, which is what a controls team recognises and
 * what stays stable across re-exports. P6's internal `task_id` changes between
 * databases and would match nothing after a schedule is rebuilt.
 */

export type ScheduleImport = {
  rows: string[][];
  meta: {
    version: string;
    exportedAt: string;
    activities: number;
    /** Stated rather than assumed: P6 stores durations in hours. */
    hoursPerDay: number;
    /** P6 projects in the file, when it holds more than one. */
    projects: string[];
  };
};

export function xerToTable(text: string): ScheduleImport {
  const file = parseXer(text);
  const tasks = file.tables.get("TASK");

  if (!tasks || tasks.rows.length === 0) {
    throw new Error("That XER has no activities in its TASK table");
  }

  const projects = [...new Set(tasks.rows.map((r) => r.proj_id).filter(Boolean))];

  // The header the register mapping already understands, so nothing about P6
  // needs to be special-cased downstream.
  const header = [
    "Activity ID",
    "Status",
    "Percent complete",
    "Forecast start",
    "Forecast finish",
    "Total float",
  ];

  const rows: string[][] = [header];

  for (const row of tasks.rows) {
    const code = (row.task_code ?? "").trim();
    if (!code) continue;

    // Actual dates once they exist, planned dates before that — the same
    // convention the Gantt already draws.
    const start = xerDate(row.act_start_date || row.early_start_date || row.target_start_date || "");
    const finish = xerDate(
      row.act_end_date || row.early_end_date || row.target_end_date || ""
    );

    rows.push([
      code,
      xerStatus(row.status_code ?? ""),
      String(xerPercent(row)),
      start ?? "",
      finish ?? "",
      String(xerDays(row.total_float_hr_cnt ?? "")),
    ]);
  }

  return {
    rows,
    meta: {
      version: file.version,
      exportedAt: file.exportedAt,
      activities: rows.length - 1,
      hoursPerDay: HOURS_PER_DAY,
      projects,
    },
  };
}
