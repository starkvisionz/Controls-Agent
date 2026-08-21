import type { Task, WbsNode } from "@/lib/types";

const DAY = 86_400_000;

export type GanttRow =
  | {
      kind: "wbs";
      id: string;
      code: string;
      name: string;
      level: number;
      start: string;
      finish: string;
      percentComplete: number;
      budget: number;
      taskCount: number;
      hasChildren: boolean;
      expanded: boolean;
    }
  | { kind: "task"; id: string; level: number; task: Task };

export type WbsRollup = {
  start: string;
  finish: string;
  percentComplete: number;
  budget: number;
  earned: number;
  taskCount: number;
};

/**
 * Rolls each WBS node up from the activities beneath it: earliest start,
 * latest finish, and a budget-weighted percent complete. Weighting by budget
 * rather than activity count keeps a $40M erection package from being averaged
 * away by four small procedural activities.
 */
export function rollUpWbs(nodes: WbsNode[], tasks: Task[]): Map<string, WbsRollup> {
  const childrenOf = new Map<string, WbsNode[]>();
  for (const node of nodes) {
    const key = node.parent_id ?? "__root__";
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), node]);
  }

  const tasksOf = new Map<string, Task[]>();
  for (const task of tasks) {
    tasksOf.set(task.wbs_id, [...(tasksOf.get(task.wbs_id) ?? []), task]);
  }

  const result = new Map<string, WbsRollup>();

  const visit = (node: WbsNode): WbsRollup => {
    const own = tasksOf.get(node.id) ?? [];
    const childRollups = (childrenOf.get(node.id) ?? []).map(visit);

    const starts: string[] = [
      ...own.map((t) => t.forecast_start),
      ...childRollups.map((c) => c.start),
    ].filter(Boolean);
    const finishes: string[] = [
      ...own.map((t) => t.forecast_finish),
      ...childRollups.map((c) => c.finish),
    ].filter(Boolean);

    const budget =
      own.reduce((s, t) => s + t.budget, 0) + childRollups.reduce((s, c) => s + c.budget, 0);
    const earned =
      own.reduce((s, t) => s + t.budget * (t.percent_complete / 100), 0) +
      childRollups.reduce((s, c) => s + c.earned, 0);

    // A zero-budget branch (milestones) has nothing to weight by, so fall back
    // to a plain mean over its activities.
    const meanPercent =
      own.length > 0 ? own.reduce((s, t) => s + t.percent_complete, 0) / own.length : 0;

    const rollup: WbsRollup = {
      start: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : "",
      finish: finishes.length ? finishes.reduce((a, b) => (a > b ? a : b)) : "",
      percentComplete: budget > 0 ? (earned / budget) * 100 : meanPercent,
      budget,
      earned,
      taskCount: own.length + childRollups.reduce((s, c) => s + c.taskCount, 0),
    };

    result.set(node.id, rollup);
    return rollup;
  };

  for (const root of childrenOf.get("__root__") ?? []) visit(root);
  return result;
}

/** Flattens the WBS tree into the visible row list, honouring collapsed nodes. */
export function buildRows(
  nodes: WbsNode[],
  tasks: Task[],
  rollups: Map<string, WbsRollup>,
  collapsed: Set<string>
): GanttRow[] {
  const childrenOf = new Map<string, WbsNode[]>();
  for (const node of nodes) {
    const key = node.parent_id ?? "__root__";
    childrenOf.set(key, [...(childrenOf.get(key) ?? []), node]);
  }

  const tasksOf = new Map<string, Task[]>();
  for (const task of tasks) {
    tasksOf.set(task.wbs_id, [...(tasksOf.get(task.wbs_id) ?? []), task]);
  }

  const rows: GanttRow[] = [];

  const walk = (node: WbsNode, level: number) => {
    const rollup = rollups.get(node.id);
    const children = childrenOf.get(node.id) ?? [];
    const own = tasksOf.get(node.id) ?? [];
    const isCollapsed = collapsed.has(node.id);

    rows.push({
      kind: "wbs",
      id: node.id,
      code: node.code,
      name: node.name,
      level,
      start: rollup?.start ?? "",
      finish: rollup?.finish ?? "",
      percentComplete: rollup?.percentComplete ?? 0,
      budget: rollup?.budget ?? node.budget,
      taskCount: rollup?.taskCount ?? 0,
      hasChildren: children.length > 0 || own.length > 0,
      expanded: !isCollapsed,
    });

    if (isCollapsed) return;

    for (const child of children) walk(child, level + 1);
    for (const task of own) {
      rows.push({ kind: "task", id: task.id, level: level + 1, task });
    }
  };

  for (const root of childrenOf.get("__root__") ?? []) walk(root, 0);
  return rows;
}

/** Inclusive day offset from the timeline origin. */
export function dayOffset(origin: string, date: string): number {
  return Math.round((new Date(date).getTime() - new Date(origin).getTime()) / DAY);
}

export type TimelineTick = { label: string; offsetDays: number; major: boolean };

/**
 * Gridlines on every month boundary, but a label only where one will fit.
 * Zoomed out, that means quarters or bare years — an unreadable smear of
 * three-letter month names is worse than no label at all.
 */
export function monthTicks(origin: string, totalDays: number, dayWidth: number): TimelineTick[] {
  const monthPx = dayWidth * 30.4;
  const labelEvery = monthPx >= 26 ? 1 : monthPx * 3 >= 26 ? 3 : 12;

  const ticks: TimelineTick[] = [];
  const start = new Date(origin);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  while (true) {
    const offsetDays = dayOffset(origin, cursor.toISOString().slice(0, 10));
    if (offsetDays > totalDays) break;
    if (offsetDays < 0) {
      // The origin sits mid-month; that first partial month has no gridline.
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      continue;
    }

    const month = cursor.getUTCMonth();
    const january = month === 0;
    const labelled = january || month % labelEvery === 0;

    ticks.push({
      label: !labelled
        ? ""
        : january
          ? String(cursor.getUTCFullYear())
          : cursor.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }),
      offsetDays,
      major: january,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return ticks;
}
