"use client";

import { useMemo, useState } from "react";
import { History, ShieldCheck } from "lucide-react";
import { useResource } from "@/lib/use-resource";
import { useProjects } from "@/components/shell/ProjectContext";
import { useSession } from "@/components/shell/SessionContext";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/Table";
import { Badge, type Tone } from "@/components/ui/Badge";
import { LoadingPane, SearchInput, Segmented, Select, StateMessage, Toolbar } from "@/components/ui/Controls";
import type { AuditEvent } from "@/lib/audit";
import { ChangeList, describeAction, when } from "./ChangeList";

const ENTITY_LABEL: Record<string, string> = {
  task: "Activity",
  risk: "Risk",
  document: "Document",
  change_order: "Change order",
  account: "Account",
};

const ACTION_TONE: Record<string, Tone> = {
  approve: "good",
  reject: "bad",
  disable: "bad",
  enable: "good",
  create: "accent",
  "reset-password": "warn",
  "sign-in": "neutral",
  update: "neutral",
};

/**
 * What has happened on this project, newest first.
 *
 * Scoped to the active project like every other view. Account changes belong to
 * no project and have their own tab, which only an administrator sees — a
 * planner should know who moved an activity, not who changed somebody's role.
 */
export function ActivityView() {
  const { activeProject } = useProjects();
  const { can } = useSession();
  const maySeeAccounts = can("user:manage");

  const [tab, setTab] = useState<"project" | "accounts">("project");
  const [entity, setEntity] = useState("all");
  const [query, setQuery] = useState("");
  // Sign-ins are the highest-volume event and the least interesting one to an
  // administrator opening this tab, who came to see who was given or refused
  // access. Available, but not in the way.
  const [showSignIns, setShowSignIns] = useState(false);

  const url =
    tab === "accounts" && maySeeAccounts
      ? "/api/audit?scope=accounts"
      : activeProject
        ? `/api/audit?project=${encodeURIComponent(activeProject.id)}`
        : null;

  const { data, error, loading } = useResource<{ events: AuditEvent[] }>(url);

  const events = useMemo(() => {
    const all = data?.events ?? [];
    const needle = query.trim().toLowerCase();
    return all.filter((e) => {
      if (e.action === "sign-in" && !showSignIns) return false;
      if (entity !== "all" && e.entity_type !== entity) return false;
      if (!needle) return true;
      return (
        e.entity_label.toLowerCase().includes(needle) ||
        e.summary.toLowerCase().includes(needle) ||
        e.actor_name.toLowerCase().includes(needle)
      );
    });
  }, [data, entity, query, showSignIns]);

  if (loading) return <LoadingPane label="Loading activity" />;
  if (error) return <StateMessage title="Could not load activity" detail={error} />;

  const present = [...new Set((data?.events ?? []).map((e) => e.entity_type))];
  const hiddenSignIns =
    !showSignIns && (data?.events ?? []).filter((e) => e.action === "sign-in").length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <Toolbar>
        {maySeeAccounts ? (
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "project", label: "This project" },
              { value: "accounts", label: "Accounts" },
            ]}
          />
        ) : null}

        {tab === "accounts" ? (
          <Select
            label="Sign-ins"
            value={showSignIns ? "show" : "hide"}
            onChange={(v) => setShowSignIns(v === "show")}
            options={[
              { value: "hide", label: "Hidden" },
              { value: "show", label: "Shown" },
            ]}
          />
        ) : null}

        {present.length > 1 ? (
          <Select
            label="Record"
            value={entity}
            onChange={setEntity}
            options={[
              { value: "all", label: "All" },
              ...present.map((t) => ({ value: t, label: ENTITY_LABEL[t] ?? t })),
            ]}
          />
        ) : null}

        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Find a record or a person…"
          className="ml-auto w-[260px]"
        />
      </Toolbar>

      <Panel flush className="min-h-0 flex-1">
        <PanelHeader
          title={tab === "accounts" ? "Account changes" : "Project activity"}
          icon={tab === "accounts" ? <ShieldCheck /> : <History />}
          subtitle={
            tab === "accounts"
              ? "Who was given or refused access, and by whom"
              : "Every change to this project's registers, newest first"
          }
        />

        {events.length === 0 ? (
          <StateMessage
            title="Nothing recorded yet"
            detail={
              (data?.events ?? []).length > 0
                ? hiddenSignIns
                  ? `No entries match the filters above. ${hiddenSignIns} sign-in${hiddenSignIns === 1 ? " is" : "s are"} hidden.`
                  : "No entries match the filters above."
                : "The log starts from the first change made after this was installed — it does not reconstruct history from before then."
            }
          />
        ) : (
          <TableWrap>
            <Table fill>
              <THead>
                <TH width="132px">When</TH>
                <TH width="150px">Who</TH>
                <TH width="104px">Did what</TH>
                <TH width="120px">Record</TH>
                <TH width="230px">Which</TH>
                <TH>What changed</TH>
              </THead>
              <tbody>
                {events.map((e) => (
                  <TR key={e.id}>
                    <TD mono className="text-ink-faint" title={e.at}>
                      {when(e.at)}
                    </TD>
                    <TD className="truncate text-ink-dim" title={e.actor_email}>
                      {e.actor_name}
                    </TD>
                    <TD>
                      <Badge tone={ACTION_TONE[e.action] ?? "neutral"}>
                        {describeAction(e.action)}
                      </Badge>
                    </TD>
                    <TD className="text-ink-faint">{ENTITY_LABEL[e.entity_type] ?? e.entity_type}</TD>
                    <TD className="truncate text-ink-mute" title={e.summary}>
                      <span className="font-mono text-accent-hi">{e.entity_label}</span>
                      {e.summary ? <span className="ml-1.5 text-ink-faint">{e.summary}</span> : null}
                    </TD>
                    <TD className="text-ink-mute">
                      <ChangeList changes={e.changes} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
