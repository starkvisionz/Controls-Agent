"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Project, ProjectMetrics } from "@/lib/types";

export type ProjectWithMetrics = Project & { metrics: ProjectMetrics };

type ProjectContextValue = {
  projects: ProjectWithMetrics[];
  activeProject: ProjectWithMetrics | null;
  activeProjectId: string | null;
  setActiveProjectId: (id: string) => void;
  loading: boolean;
  error: string | null;
};

const Ctx = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = "hermes.activeProject";

/**
 * Holds the portfolio and the project the whole shell is pointed at. Every
 * view reads the active project from here, so switching projects in the title
 * bar re-points the entire application without a navigation.
 */
export function ProjectProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectWithMetrics[]>([]);
  const [activeProjectId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/projects")
      .then(async (res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json() as Promise<{ projects: ProjectWithMetrics[] }>;
      })
      .then(({ projects: list }) => {
        if (cancelled) return;
        setProjects(list);

        const remembered =
          typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
        const initial = list.find((p) => p.id === remembered) ?? list[0];
        setActiveId(initial?.id ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load the portfolio");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setActiveProjectId = useCallback((id: string) => {
    setActiveId(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Private browsing or blocked storage — the selection just won't persist.
    }
  }, []);

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      activeProject: projects.find((p) => p.id === activeProjectId) ?? null,
      activeProjectId,
      setActiveProjectId,
      loading,
      error,
    }),
    [projects, activeProjectId, setActiveProjectId, loading, error]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjects(): ProjectContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProjects must be used inside <ProjectProvider>");
  return ctx;
}
