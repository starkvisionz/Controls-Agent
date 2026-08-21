"use client";

import { useCallback, useMemo, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, ZoomIn, ZoomOut } from "lucide-react";
import { Gantt } from "./Gantt";
import { TaskDetail } from "./TaskDetail";
import { Stat } from "@/components/ui/Stat";
import {
  IconButton,
  LoadingPane,
  SearchInput,
  Segmented,
  Select,
  StateMessage,
  Toolbar,
} from "@/components/ui/Controls";
import { useProjects } from "@/components/shell/ProjectContext";
import { useResource } from "@/lib/use-resource";
import { daysBetween, percent, shortDate } from "@/lib/format";
import type { Project, Task, WbsNode } from "@/lib/types";

type SchedulePayload = { project: Project; wbs: WbsNode[]; tasks: Task[] };

type Filter = "all" | "critical" | "slipping" | "in-progress" | "milestones";

const ZOOM_STEPS = [0.55, 0.9, 1.5, 2.6, 4.5];

export function ScheduleView() {
  const { activeProjectId } = useProjects();
  const { data, loading, error } = useResource<SchedulePayload>(
    activeProjectId ? `/api/projects/${activeProjectId}/schedule` : null
  );

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [zoom, setZoom] = useState(ZOOM_STEPS[0]);
  const [filter, setFilter] = useState<Filter>("all");
  const [discipline, setDiscipline] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Task | null>(null);
  // Edits made in the inspector are merged in locally so the Gantt updates
  // without a full refetch of several hundred activities.
  const [overrides, setOverrides] = useState<Record<string, Task>>({});

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const tasks = useMemo(() => {
    if (!data) return [];
    const merged = data.tasks.map((t) => overrides[t.id] ?? t);
    const needle = query.trim().toLowerCase();

    return merged.filter((t) => {
      if (discipline !== "all" && t.discipline !== discipline) return false;
      if (needle && !`${t.code} ${t.name} ${t.responsible}`.toLowerCase().includes(needle)) {
        return false;
      }
      switch (filter) {
        case "critical":
          return t.is_critical === 1 && t.status !== "complete";
        case "slipping":
          return t.status !== "complete" && t.forecast_finish > t.baseline_finish;
        case "in-progress":
          return t.status === "in-progress" || t.status === "blocked";
        case "milestones":
          return t.is_milestone === 1;
        default:
          return true;
      }
    });
  }, [data, overrides, query, filter, discipline]);

  // Hide WBS branches that hold nothing after filtering, so the tree does not
  // fill with empty parents.
  const visibleWbs = useMemo(() => {
    if (!data) return [];
    if (filter === "all" && discipline === "all" && !query.trim()) return data.wbs;

    const keep = new Set<string>();
    const byId = new Map(data.wbs.map((n) => [n.id, n]));
    for (const task of tasks) {
      let node = byId.get(task.wbs_id);
      while (node) {
        keep.add(node.id);
        node = node.parent_id ? byId.get(node.parent_id) : undefined;
      }
    }
    return data.wbs.filter((n) => keep.has(n.id));
  }, [data, tasks, filter, discipline, query]);

  const disciplines = useMemo(() => {
    const set = new Set((data?.tasks ?? []).map((t) => t.discipline).filter(Boolean));
    return ["all", ...[...set].sort()];
  }, [data]);

  const summary = useMemo(() => {
    const all = (data?.tasks ?? []).map((t) => overrides[t.id] ?? t).filter((t) => !t.is_milestone);
    const complete = all.filter((t) => t.status === "complete").length;
    const critical = all.filter((t) => t.is_critical === 1 && t.status !== "complete").length;
    const slipping = all.filter(
      (t) => t.status !== "complete" && t.forecast_finish > t.baseline_finish
    );
    const worstSlip = slipping.reduce(
      (worst, t) => Math.max(worst, daysBetween(t.baseline_finish, t.forecast_finish)),
      0
    );
    const budget = all.reduce((s, t) => s + t.budget, 0);
    const earned = all.reduce((s, t) => s + t.budget * (t.percent_complete / 100), 0);

    return {
      total: all.length,
      complete,
      critical,
      slipping: slipping.length,
      worstSlip,
      progress: budget > 0 ? (earned / budget) * 100 : 0,
    };
  }, [data, overrides]);

  const applyEdit = (task: Task) => {
    setOverrides((prev) => ({ ...prev, [task.id]: task }));
    setSelected(task);
  };

  if (loading) return <LoadingPane label="Loading schedule" />;
  if (error || !data) {
    return <StateMessage title="Could not load the schedule" detail={error ?? undefined} />;
  }

  const zoomIndex = ZOOM_STEPS.indexOf(zoom) === -1 ? 2 : ZOOM_STEPS.indexOf(zoom);
  const allWbsIds = data.wbs.map((n) => n.id);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "critical", label: `Critical ${summary.critical}` },
            { value: "slipping", label: `Slipping ${summary.slipping}` },
            { value: "in-progress", label: "In progress" },
            { value: "milestones", label: "Milestones" },
          ]}
        />
        <Select
          label="Discipline"
          value={discipline}
          onChange={setDiscipline}
          options={disciplines.map((d) => ({ value: d, label: d === "all" ? "All" : d }))}
        />
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Find an activity…"
          className="w-48 min-w-40 grow sm:grow-0"
        />

        <div className="ml-auto flex items-center gap-1">
          <IconButton
            title="Collapse all"
            onClick={() => setCollapsed(new Set(allWbsIds))}
          >
            <ChevronsDownUp />
          </IconButton>
          <IconButton title="Expand all" onClick={() => setCollapsed(new Set())}>
            <ChevronsUpDown />
          </IconButton>
          <span className="mx-1 h-4 w-px bg-line" />
          <IconButton
            title="Zoom out"
            disabled={zoomIndex === 0}
            onClick={() => setZoom(ZOOM_STEPS[Math.max(0, zoomIndex - 1)])}
          >
            <ZoomOut />
          </IconButton>
          <IconButton
            title="Zoom in"
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            onClick={() => setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1)])}
          >
            <ZoomIn />
          </IconButton>
        </div>
      </Toolbar>

      <div className="@container flex-none border-b border-line px-3 py-2">
        <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-5">
          <Stat label="Activities" value={String(summary.total)} context={`${summary.complete} complete`} />
          <Stat label="Progress" value={percent(summary.progress)} context="budget-weighted" />
          <Stat
            label="Critical"
            value={String(summary.critical)}
            tone={summary.critical > 0 ? "warn" : "good"}
            context="incomplete, float ≤ 5d"
          />
          <Stat
            label="Slipping"
            value={String(summary.slipping)}
            tone={summary.slipping > 0 ? "bad" : "good"}
            context={summary.worstSlip > 0 ? `worst ${summary.worstSlip}d late` : "none past baseline"}
          />
          <Stat
            label="Forecast finish"
            value={shortDate(data.project.forecast_finish)}
            tone={data.project.forecast_finish > data.project.baseline_finish ? "bad" : "good"}
            context={`baseline ${shortDate(data.project.baseline_finish)}`}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {tasks.length === 0 ? (
          <StateMessage
            title="No activities match these filters"
            detail="Clear the search or switch back to All."
          />
        ) : (
          <Gantt
            wbs={visibleWbs}
            tasks={tasks}
            dataDate={data.project.data_date}
            dayWidth={zoom}
            collapsed={collapsed}
            onToggle={toggle}
            selectedId={selected?.id ?? null}
            onSelect={setSelected}
          />
        )}

        {selected ? (
          <TaskDetail task={selected} onClose={() => setSelected(null)} onSaved={applyEdit} />
        ) : null}
      </div>
    </div>
  );
}
