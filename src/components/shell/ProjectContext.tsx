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
import { usePersistedString } from "@/lib/persisted-flag";
import type { Project, ProjectMetrics } from "@/lib/types";
import type { Role } from "@/lib/rbac";

/**
 * `role` is the role the signed-in account holds *on this project*, which is
 * not always its portfolio-wide role — a lead on one train can be a reader on
 * the next. The API sends it with each row so the UI never has to guess.
 */
export type ProjectWithMetrics = Project & { metrics: ProjectMetrics; role: Role | null };

type ProjectContextValue = {
  projects: ProjectWithMetrics[];
  activeProject: ProjectWithMetrics | null;
  activeProjectId: string | null;
  setActiveProjectId: (id: string) => void;
  /**
   * Re-reads the portfolio.
   *
   * The status bar and the project switcher render from this context, so any
   * write that moves project metrics — activity progress, an approved change
   * order — has to call this or the chrome keeps quoting the figures from page
   * load. A view that shows a number moving while the status bar underneath it
   * does not is the same "two sets of figures" problem the roll-up exists to
   * prevent, just moved into the client.
   */
  refresh: () => void;
  /** Set only when an explicit refresh fails; the first load cannot fail here. */
  error: string | null;
};

const Ctx = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = "starkvisionz.activeProject";

/**
 * Holds the portfolio and the project the whole shell is pointed at. Every
 * view reads the active project from here, so switching projects in the title
 * bar re-points the entire application without a navigation.
 */
export function ProjectProvider({
  children,
  initialProjects,
}: {
  children: ReactNode;
  /**
   * The portfolio, resolved on the server and sent with the first HTML.
   *
   * The layout has already authenticated the request and knows which projects
   * this account may see, so fetching the same list again from the browser was
   * a round trip that bought nothing — and it was a *blocking* one: no view
   * could ask for its own data until the active project was known, so every
   * page load ran two requests in series behind a loading pane.
   */
  initialProjects: ProjectWithMetrics[];
}) {
  const [projects, setProjects] = useState<ProjectWithMetrics[]>(initialProjects);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  // The selection lives in localStorage and is derived from it, rather than
  // being copied into state and restored in an effect. That keeps one source of
  // truth, survives a reload, and follows the choice made in another tab.
  const [remembered, remember] = usePersistedString(STORAGE_KEY);

  // Falls back to the first project when nothing is remembered, and again when
  // what was remembered is a project this account can no longer reach.
  const activeProjectId =
    (projects.find((p) => p.id === remembered) ?? projects[0])?.id ?? null;

  // Only re-fetches on an explicit refresh() — after a write that moved the
  // figures the status bar and switcher display.
  useEffect(() => {
    if (nonce === 0) return;
    let cancelled = false;

    fetch("/api/projects")
      .then(async (res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json() as Promise<{ projects: ProjectWithMetrics[] }>;
      })
      .then(({ projects: list }) => {
        if (cancelled) return;
        setProjects(list);

        // Only choose a project on the first load. A refresh must not pull the
        // user back to a different project mid-edit.
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load the portfolio");
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const setActiveProjectId = remember;

  const value = useMemo<ProjectContextValue>(
    () => ({
      projects,
      activeProject: projects.find((p) => p.id === activeProjectId) ?? null,
      activeProjectId,
      setActiveProjectId,
      refresh,
      error,
    }),
    [projects, activeProjectId, setActiveProjectId, refresh, error]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProjects(): ProjectContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useProjects must be used inside <ProjectProvider>");
  return ctx;
}
