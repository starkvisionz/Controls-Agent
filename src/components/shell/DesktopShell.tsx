"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePersistedFlag } from "@/lib/persisted-flag";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { ProjectProvider, useProjects } from "./ProjectContext";
import { SessionProvider } from "./SessionContext";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { AgentPanel } from "@/components/chat/AgentPanel";
import { LoadingPane, StateMessage } from "@/components/ui/Controls";
import { PasswordGate } from "./PasswordGate";
import type { Principal } from "@/lib/rbac";

/** Persisted separately so each toggle is its own value, not a parsed blob. */
const CHROME_KEYS = {
  collapsed: "starkvisionz.chrome.collapsed",
  agentOpen: "starkvisionz.chrome.agentOpen",
} as const;

/**
 * localStorage is not available while server-rendering, and it can throw
 * outright when site data is blocked. This shim keeps the layout code from
 * having to care either way.
 */
const safeStorage = {
  getItem(key: string): string | null {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(key, value);
    } catch {
      // Blocked storage — the layout just won't persist.
    }
  },
};

export function DesktopShell({
  children,
  principal,
  authEnforced,
  mustChangePassword,
}: {
  children: ReactNode;
  principal: Principal;
  authEnforced: boolean;
  mustChangePassword: boolean;
}) {
  return (
    <SessionProvider
      principal={principal}
      enforced={authEnforced}
      mustChangePassword={mustChangePassword}
    >
      {/* A starting password somebody else chose is replaced before the
          registers are on screen, not after. */}
      {mustChangePassword ? (
        <PasswordGate name={principal.name} />
      ) : (
        <ProjectProvider>
          <ShellFrame>{children}</ShellFrame>
        </ProjectProvider>
      )}
    </SessionProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const { loading, error } = useProjects();
  const [collapsed, setCollapsed] = usePersistedFlag(CHROME_KEYS.collapsed, false);
  const [agentOpen, setAgentOpen] = usePersistedFlag(CHROME_KEYS.agentOpen, true);
  const [agentSource, setAgentSource] = useState<"claude" | "local" | null>(null);

  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "starkvisionz.main",
    storage: safeStorage,
    panelIds: ["workspace", "agent"],
    onlySaveAfterUserInteractions: true,
  });

  const toggleSidebar = useCallback(() => setCollapsed((v) => !v), [setCollapsed]);
  const toggleAgent = useCallback(() => setAgentOpen((v) => !v), [setAgentOpen]);

  // Cmd/Ctrl-J toggles the agent panel, the way a desktop app would.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        toggleAgent();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleAgent]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <TitleBar agentOpen={agentOpen} onToggleAgent={toggleAgent} />

      <div className="flex min-h-0 flex-1">
        <Sidebar collapsed={collapsed} onToggle={toggleSidebar} badges={{}} />

        <div className="min-w-0 flex-1">
          {loading ? (
            <LoadingPane label="Opening the controls database" />
          ) : error ? (
            <StateMessage
              title="The controls database is unavailable"
              detail={`${error}. Run \`npm run db:seed\` to build it, then reload.`}
            />
          ) : (
            <Group
              orientation="horizontal"
              defaultLayout={defaultLayout}
              onLayoutChanged={onLayoutChanged}
              className="h-full"
            >
              <Panel id="workspace" defaultSize="72%" minSize="40%" className="min-w-0">
                <main className="h-full min-h-0 overflow-hidden">{children}</main>
              </Panel>

              {agentOpen ? (
                <>
                  <Separator className="resize-handle w-px" />
                  <Panel
                    id="agent"
                    defaultSize="28%"
                    minSize="20%"
                    maxSize="50%"
                    className="min-w-0"
                  >
                    <AgentPanel onSourceChange={setAgentSource} />
                  </Panel>
                </>
              ) : null}
            </Group>
          )}
        </div>
      </div>

      <StatusBar agentSource={agentSource} />
    </div>
  );
}
