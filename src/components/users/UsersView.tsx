"use client";

import { useState } from "react";
import { Plus, ShieldAlert, UserRound } from "lucide-react";
import { useResource } from "@/lib/use-resource";
import { useProjects } from "@/components/shell/ProjectContext";
import { useSession } from "@/components/shell/SessionContext";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";
import { LoadingPane, StateMessage, Toolbar } from "@/components/ui/Controls";
import { ROLE_LABELS, type Role } from "@/lib/rbac";
import type { PublicUser } from "@/lib/users";
import { UserEditor } from "./UserEditor";
import { shortDate } from "@/lib/format";

const ROLE_TONE: Record<Role, "accent" | "info" | "warn" | "neutral"> = {
  admin: "accent",
  controls_lead: "info",
  planner: "warn",
  viewer: "neutral",
};

/**
 * Accounts and what each one may reach.
 *
 * Reachable only by an administrator, and the API says the same thing
 * independently — the route refuses `user:manage` to everyone else, so hiding
 * the link is a courtesy rather than the control.
 */
export function UsersView() {
  const { principal } = useSession();
  const { projects } = useProjects();
  const { data, error, loading, reload } = useResource<{ users: PublicUser[] }>("/api/users");
  const [editing, setEditing] = useState<PublicUser | "new" | null>(null);

  const codeFor = (projectId: string) =>
    projects.find((p) => p.id === projectId)?.code ?? projectId;

  if (loading) return <LoadingPane label="Loading accounts" />;
  if (error) return <StateMessage title="Could not load accounts" detail={error} />;

  const users = data?.users ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <Toolbar>
        <span className="text-2xs text-ink-mute">
          {users.length} account{users.length === 1 ? "" : "s"}
        </span>
        <span className="text-2xs text-ink-faint">
          {users.filter((u) => u.role === "admin" && u.is_active).length} administrator
          {users.filter((u) => u.role === "admin" && u.is_active).length === 1 ? "" : "s"}
        </span>
        <button
          onClick={() => setEditing("new")}
          className="ml-auto flex h-6 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-2 text-2xs text-accent-hi transition-colors hover:bg-accent/15"
        >
          <Plus className="h-3 w-3" />
          New account
        </button>
      </Toolbar>

      <Panel flush className="min-h-0 flex-1">
        <PanelHeader
          title="Accounts"
          icon={<UserRound />}
          subtitle="Role decides what an account may change; scope decides where"
        />
        <TableWrap>
          <Table fill>
            <THead>
              <TH width="220px">Name</TH>
              <TH width="240px">Email</TH>
              <TH width="130px">Role</TH>
              <TH width="260px">Projects</TH>
              <TH width="110px">Last signed in</TH>
              <TH width="120px">State</TH>
            </THead>
            <tbody>
              {users.map((user) => {
                const self = user.id === principal.id;
                return (
                  <TR key={user.id} onClick={() => setEditing(user)}>
                    <TD className="text-ink">
                      {user.name}
                      {self ? <span className="ml-1.5 text-[10px] text-ink-faint">you</span> : null}
                    </TD>
                    <TD className="text-ink-mute">{user.email}</TD>
                    <TD>
                      <Badge tone={ROLE_TONE[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                    </TD>
                    <TD className="text-ink-mute">
                      {user.projects.length === 0 ? (
                        <span className="text-ink-faint">All projects</span>
                      ) : (
                        user.projects
                          .map((g) =>
                            g.role ? `${codeFor(g.project_id)} (${ROLE_LABELS[g.role]})` : codeFor(g.project_id)
                          )
                          .join(", ")
                      )}
                    </TD>
                    <TD mono className="text-ink-mute">
                      {user.last_login_at ? shortDate(user.last_login_at.slice(0, 10)) : "—"}
                    </TD>
                    <TD>
                      {!user.is_active ? (
                        <Badge tone="bad">Disabled</Badge>
                      ) : user.must_change_password ? (
                        <Badge tone="warn">Password pending</Badge>
                      ) : (
                        <Badge tone="good">Active</Badge>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      </Panel>

      <div className="flex items-start gap-2 rounded-panel border border-line bg-chrome px-3 py-2 text-[10px] leading-relaxed text-ink-faint">
        <ShieldAlert className="mt-px h-3 w-3 shrink-0" />
        <p>
          Accounts are disabled rather than deleted, so who made a change stays legible. Changing
          a role, a password or a project scope ends that account&apos;s open sessions
          immediately.
        </p>
      </div>

      {editing ? (
        <UserEditor
          user={editing === "new" ? null : editing}
          projects={projects}
          isSelf={editing !== "new" && editing.id === principal.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      ) : null}
    </div>
  );
}
