"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, LogOut, MessageSquareText, Radio } from "lucide-react";
import { useProjects } from "./ProjectContext";
import { index, money, shortDate } from "@/lib/format";

/**
 * The window chrome. Carries the app identity, the project switcher (which
 * re-points every view at once) and the agent-panel toggle.
 */
export function TitleBar({
  agentOpen,
  onToggleAgent,
  authEnforced,
}: {
  agentOpen: boolean;
  onToggleAgent: () => void;
  /** Hides the sign-out control when the app is running unauthenticated. */
  authEnforced: boolean;
}) {
  const router = useRouter();
  const { projects, activeProject, setActiveProjectId } = useProjects();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <header className="flex h-9 flex-none items-center gap-3 border-b border-line bg-chrome px-3">
      {/* Traffic lights — decorative window furniture, this runs in a browser. */}
      <div className="flex items-center gap-[6px]" aria-hidden>
        <span className="h-[10px] w-[10px] rounded-full bg-[#3a3f47]" />
        <span className="h-[10px] w-[10px] rounded-full bg-[#3a3f47]" />
        <span className="h-[10px] w-[10px] rounded-full bg-[#3a3f47]" />
      </div>

      <div className="ml-1 flex items-baseline gap-1.5">
        <span className="text-sm font-semibold tracking-[0.16em] text-ink">STARKVISIONZ</span>
        <span className="text-[10px] uppercase tracking-wider text-ink-faint">
          Project Controls
        </span>
      </div>

      {/* Project switcher */}
      <div className="relative ml-4" ref={menuRef}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex h-6 items-center gap-2 rounded-sm border border-line bg-raised px-2 text-2xs transition-colors hover:border-line-strong"
        >
          {activeProject ? (
            <>
              <span className="font-mono font-medium text-accent-hi tabular">
                {activeProject.code}
              </span>
              <span className="max-w-[240px] truncate text-ink-dim">{activeProject.name}</span>
            </>
          ) : (
            <span className="text-ink-faint">No project</span>
          )}
          <ChevronDown className="h-3 w-3 text-ink-faint" />
        </button>

        {open ? (
          <div
            role="listbox"
            className="animate-in absolute left-0 top-7 z-50 w-[380px] overflow-hidden rounded-panel border border-line-strong bg-overlay shadow-2xl shadow-black/60"
          >
            <div className="label border-b border-line px-3 py-1.5">Portfolio</div>
            {projects.map((p) => {
              const selected = p.id === activeProject?.id;
              return (
                <button
                  key={p.id}
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    setActiveProjectId(p.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-3 border-b border-line-soft px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-raised"
                >
                  <Check
                    className={`h-3 w-3 shrink-0 text-accent ${selected ? "opacity-100" : "opacity-0"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-2xs font-medium text-accent-hi tabular">
                        {p.code}
                      </span>
                      <span className="truncate text-2xs text-ink">{p.name}</span>
                    </div>
                    <div className="truncate text-[10px] text-ink-faint">
                      {p.client} · {p.phase} · {money(p.budget_at_completion, { compact: true })}
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-mono text-[10px] tabular">
                    <div className={p.metrics.spi >= 1 ? "text-good" : "text-bad"}>
                      SPI {index(p.metrics.spi)}
                    </div>
                    <div className={p.metrics.cpi >= 1 ? "text-good" : "text-bad"}>
                      CPI {index(p.metrics.cpi)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {activeProject ? (
        <div className="ml-2 hidden items-center gap-1.5 text-2xs text-ink-faint lg:flex">
          <Radio className="h-3 w-3 text-good" />
          <span>Data date</span>
          <span className="font-mono text-ink-mute tabular">
            {shortDate(activeProject.data_date)}
          </span>
        </div>
      ) : null}

      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={onToggleAgent}
          title={agentOpen ? "Hide the agent panel" : "Show the agent panel"}
          className={`flex h-6 items-center gap-1.5 rounded-sm border px-2 text-2xs transition-colors ${
            agentOpen
              ? "border-accent/40 bg-accent/10 text-accent-hi"
              : "border-line bg-raised text-ink-mute hover:text-ink-dim"
          }`}
        >
          <MessageSquareText className="h-3 w-3" />
          Agent
        </button>

        {authEnforced ? (
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.replace("/login");
              // Drops the cached RSC payload so no project data survives the
              // sign-out in the client router cache.
              router.refresh();
            }}
            title="Sign out"
            aria-label="Sign out"
            className="flex h-6 w-6 items-center justify-center rounded-sm border border-line bg-raised text-ink-mute transition-colors hover:text-ink-dim"
          >
            <LogOut className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </header>
  );
}
