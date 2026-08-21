"use client";

import { useMemo, useState } from "react";
import {
  ClipboardCheck,
  FileText,
  FileWarning,
  Layers,
  Send,
  X,
} from "lucide-react";
import { Badge, Dot, type Tone } from "@/components/ui/Badge";
import { Meter, Stat } from "@/components/ui/Stat";
import { Table, TableWrap, TD, TH, THead, TR } from "@/components/ui/Table";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import {
  LoadingPane,
  SearchInput,
  Segmented,
  Select,
  StateMessage,
  Toolbar,
} from "@/components/ui/Controls";
import { useProjects } from "@/components/shell/ProjectContext";
import { useResource } from "@/lib/use-resource";
import { daysBetween, shortDate } from "@/lib/format";
import type { DocumentSummary, Project, ProjectDocument, WbsNode } from "@/lib/types";

type DocPayload = {
  project: Project;
  documents: ProjectDocument[];
  summary: DocumentSummary;
  wbs: WbsNode[];
};

type Scope = "all" | "overdue" | "in-review" | "ifc" | "draft";

/** Issue status runs draft → IFR → IFA → IFC → as-built. */
const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral",
  ifr: "info",
  ifa: "warn",
  ifc: "good",
  "as-built": "good",
  superseded: "neutral",
};

const REVIEW_TONE: Record<string, Tone> = {
  "not-started": "neutral",
  "in-review": "info",
  "code-1": "good",
  "code-2": "warn",
  "code-3": "bad",
  approved: "good",
};

const REVIEW_LABEL: Record<string, string> = {
  "not-started": "not started",
  "in-review": "in review",
  "code-1": "code 1",
  "code-2": "code 2",
  "code-3": "code 3",
  approved: "approved",
};

/** Standard client review codes, spelled out on hover and in the inspector. */
const REVIEW_MEANING: Record<string, string> = {
  "not-started": "Not yet issued for review",
  "in-review": "With the reviewer, no decision returned",
  "code-1": "Code 1 — approved, no comment",
  "code-2": "Code 2 — approved with comment, proceed and incorporate",
  "code-3": "Code 3 — not approved, revise and re-issue",
  approved: "Approved for construction",
};

const STATUS_ORDER = ["draft", "ifr", "ifa", "ifc", "as-built", "superseded"];

export function DocumentsView() {
  const { activeProjectId } = useProjects();
  const { data, loading, error } = useResource<DocPayload>(
    activeProjectId ? `/api/projects/${activeProjectId}/documents` : null
  );

  const [scope, setScope] = useState<Scope>("all");
  const [discipline, setDiscipline] = useState("all");
  const [docType, setDocType] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProjectDocument | null>(null);

  const dataDate = data?.project.data_date ?? "";

  const isOverdue = (d: ProjectDocument) =>
    Boolean(d.due_date) &&
    d.due_date! < dataDate &&
    d.review_status !== "approved" &&
    d.status !== "as-built" &&
    d.status !== "superseded";

  const disciplines = useMemo(() => {
    const set = new Set((data?.documents ?? []).map((d) => d.discipline));
    return ["all", ...[...set].sort()];
  }, [data]);

  const docTypes = useMemo(() => {
    const set = new Set((data?.documents ?? []).map((d) => d.doc_type));
    return ["all", ...[...set].sort()];
  }, [data]);

  const documents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data?.documents ?? [])
      .filter((d) => {
        if (discipline !== "all" && d.discipline !== discipline) return false;
        if (docType !== "all" && d.doc_type !== docType) return false;
        if (needle && !`${d.doc_number} ${d.title} ${d.originator} ${d.transmittal_no}`.toLowerCase().includes(needle)) {
          return false;
        }
        switch (scope) {
          case "overdue":
            return isOverdue(d);
          case "in-review":
            return d.review_status === "in-review";
          case "ifc":
            return d.status === "ifc" || d.status === "as-built";
          case "draft":
            return d.status === "draft";
          default:
            return true;
        }
      })
      .sort((a, b) => {
        // Overdue first, then by due date, so the chase list sits on top.
        const overdueDelta = Number(isOverdue(b)) - Number(isOverdue(a));
        if (overdueDelta !== 0) return overdueDelta;
        return (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999");
      });
  }, [data, scope, discipline, docType, query, dataDate]);

  const stats = useMemo(() => {
    const all = data?.documents ?? [];
    const overdue = all.filter(isOverdue);
    const byDiscipline = new Map<string, { total: number; approved: number }>();
    for (const d of all) {
      const e = byDiscipline.get(d.discipline) ?? { total: 0, approved: 0 };
      e.total += 1;
      if (d.review_status === "approved") e.approved += 1;
      byDiscipline.set(d.discipline, e);
    }
    const byStatus = new Map<string, number>();
    for (const d of all) byStatus.set(d.status, (byStatus.get(d.status) ?? 0) + 1);

    const worstOverdue = overdue.reduce(
      (worst, d) => Math.max(worst, daysBetween(d.due_date!, dataDate)),
      0
    );

    return {
      total: all.length,
      overdue: overdue.length,
      worstOverdue,
      inReview: all.filter((d) => d.review_status === "in-review").length,
      rework: all.filter((d) => d.review_status === "code-3").length,
      issuedForConstruction: all.filter((d) => d.status === "ifc" || d.status === "as-built").length,
      byDiscipline: [...byDiscipline.entries()].sort((a, b) => b[1].total - a[1].total),
      byStatus: STATUS_ORDER.map((s) => ({ status: s, count: byStatus.get(s) ?? 0 })).filter(
        (s) => s.count > 0
      ),
    };
  }, [data, dataDate]);

  if (loading) return <LoadingPane label="Loading document register" />;
  if (error || !data) {
    return <StateMessage title="Could not load the document register" detail={error ?? undefined} />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar>
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: "all", label: `All ${stats.total}` },
            { value: "overdue", label: `Overdue ${stats.overdue}` },
            { value: "in-review", label: `In review ${stats.inReview}` },
            { value: "ifc", label: "Issued for construction" },
            { value: "draft", label: "Draft" },
          ]}
        />
        <Select
          label="Discipline"
          value={discipline}
          onChange={setDiscipline}
          options={disciplines.map((d) => ({ value: d, label: d === "all" ? "All" : d }))}
        />
        <Select
          label="Type"
          value={docType}
          onChange={setDocType}
          options={docTypes.map((d) => ({ value: d, label: d === "all" ? "All" : d }))}
        />
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Find a document…"
          className="ml-auto w-48 min-w-40 grow sm:grow-0"
        />
      </Toolbar>

      <div className="flex min-h-0 flex-1">
        <div className="@container min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-3 p-3">
            <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3 @5xl:grid-cols-5">
              <Stat
                label="Register"
                value={String(stats.total)}
                icon={<FileText />}
                context={`${stats.issuedForConstruction} issued for construction`}
              />
              <Stat
                label="Overdue"
                value={String(stats.overdue)}
                tone={stats.overdue > 0 ? "bad" : "good"}
                icon={<FileWarning />}
                context={stats.worstOverdue > 0 ? `worst ${stats.worstOverdue} days past due` : "nothing past due"}
              />
              <Stat
                label="In review"
                value={String(stats.inReview)}
                tone={stats.inReview > 0 ? "info" : "neutral"}
                icon={<ClipboardCheck />}
                context="awaiting client or squad check"
              />
              <Stat
                label="Returned code 3"
                value={String(stats.rework)}
                tone={stats.rework > 0 ? "warn" : "good"}
                icon={<Send />}
                context="rework before re-issue"
              />
              <Stat
                label="Approved"
                value={`${Math.round((data.summary.approved / (stats.total || 1)) * 100)}%`}
                icon={<Layers />}
                context={`${data.summary.approved} of ${stats.total} deliverables`}
                spark={
                  <div className="w-16">
                    <Meter value={data.summary.approved} max={stats.total} tone="good" />
                  </div>
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
              <Panel>
                <h3 className="mb-3 text-2xs font-medium text-ink-dim">Issue status pipeline</h3>
                <div className="flex flex-col gap-2">
                  {stats.byStatus.map((s) => (
                    <div key={s.status} className="flex items-center gap-2">
                      <span className="w-20 shrink-0">
                        <Badge tone={STATUS_TONE[s.status] ?? "neutral"}>{s.status}</Badge>
                      </span>
                      <Meter
                        value={s.count}
                        max={stats.total}
                        tone={STATUS_TONE[s.status] ?? "neutral"}
                        className="flex-1"
                      />
                      <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ink-dim tabular">
                        {s.count}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel>
                <h3 className="mb-3 text-2xs font-medium text-ink-dim">Approval by discipline</h3>
                <div className="flex flex-col gap-2">
                  {stats.byDiscipline.map(([name, v]) => (
                    <div key={name} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 truncate text-2xs text-ink-mute">{name}</span>
                      <Meter
                        value={v.approved}
                        max={v.total}
                        tone={v.approved / v.total >= 0.75 ? "good" : v.approved / v.total >= 0.4 ? "warn" : "bad"}
                        className="flex-1"
                      />
                      <span className="w-12 shrink-0 text-right font-mono text-[10px] text-ink-faint tabular">
                        {v.approved}/{v.total}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            <Panel flush className="min-h-[320px]">
              <PanelHeader title="Document register" subtitle={`${documents.length} shown`} />
              {documents.length === 0 ? (
                <StateMessage title="No documents match these filters" />
              ) : (
                <TableWrap>
                  <Table>
                    <THead>
                      <TH width="164px">Number</TH>
                      <TH width="280px">Title</TH>
                      <TH width="94px">Type</TH>
                      <TH width="88px">Discipline</TH>
                      <TH align="center" width="42px">Rev</TH>
                      <TH width="76px">Status</TH>
                      <TH width="88px">Review</TH>
                      <TH width="94px">Originator</TH>
                      <TH width="86px">Issued</TH>
                      <TH width="86px">Due</TH>
                    </THead>
                    <tbody>
                      {documents.map((d) => {
                        const overdue = isOverdue(d);
                        const daysLate = overdue ? daysBetween(d.due_date!, dataDate) : 0;
                        return (
                          <TR
                            key={d.id}
                            onClick={() => setSelected(d)}
                            selected={selected?.id === d.id}
                          >
                            <TD mono className="text-ink-mute">{d.doc_number}</TD>
                            <TD>
                              <span className="flex items-center gap-1.5">
                                <Dot tone={overdue ? "bad" : STATUS_TONE[d.status] ?? "neutral"} />
                                <span className="truncate text-ink-dim" title={d.title}>{d.title}</span>
                              </span>
                            </TD>
                            <TD className="text-ink-mute">{d.doc_type}</TD>
                            <TD className="text-ink-mute">{d.discipline}</TD>
                            <TD align="center" mono className="text-ink-dim">{d.revision}</TD>
                            <TD>
                              <Badge tone={STATUS_TONE[d.status] ?? "neutral"}>{d.status}</Badge>
                            </TD>
                            <TD title={REVIEW_MEANING[d.review_status] ?? d.review_status}>
                              <Badge tone={REVIEW_TONE[d.review_status] ?? "neutral"}>
                                {REVIEW_LABEL[d.review_status] ?? d.review_status}
                              </Badge>
                            </TD>
                            <TD className="truncate text-ink-mute">{d.originator}</TD>
                            <TD mono className="text-ink-faint">{shortDate(d.issued_date)}</TD>
                            <TD mono className={overdue ? "text-bad" : "text-ink-faint"}>
                              {overdue ? `${daysLate}d late` : shortDate(d.due_date)}
                            </TD>
                          </TR>
                        );
                      })}
                    </tbody>
                  </Table>
                </TableWrap>
              )}
            </Panel>
          </div>
        </div>

        {selected ? (
          <DocumentDetail
            document={selected}
            dataDate={dataDate}
            onClose={() => setSelected(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DocumentDetail({
  document,
  dataDate,
  onClose,
}: {
  document: ProjectDocument;
  dataDate: string;
  onClose: () => void;
}) {
  const overdue =
    Boolean(document.due_date) &&
    document.due_date! < dataDate &&
    document.review_status !== "approved";

  return (
    <aside className="flex w-[300px] flex-none flex-col border-l border-line bg-surface">
      <header className="panel-head">
        <h3 className="truncate font-mono text-2xs text-ink-dim">{document.doc_number}</h3>
        <button
          onClick={onClose}
          aria-label="Close document detail"
          className="ml-auto text-ink-faint hover:text-ink-dim"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <h4 className="text-xs leading-snug text-ink">{document.title}</h4>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge tone={STATUS_TONE[document.status] ?? "neutral"}>{document.status}</Badge>
          <Badge tone={REVIEW_TONE[document.review_status] ?? "neutral"}>
            {REVIEW_LABEL[document.review_status] ?? document.review_status}
          </Badge>
          <Badge>Rev {document.revision}</Badge>
        </div>
        <p className="mt-1.5 text-[10px] text-ink-faint">
          {REVIEW_MEANING[document.review_status] ?? ""}
        </p>

        {overdue ? (
          <p className="mt-3 rounded-sm border border-bad/30 bg-bad-wash px-2 py-1.5 text-2xs text-bad">
            {daysBetween(document.due_date!, dataDate)} days past its review due date.
          </p>
        ) : null}

        <dl className="mt-4 flex flex-col gap-2">
          <Field label="Type" value={document.doc_type} />
          <Field label="Discipline" value={document.discipline} />
          <Field label="Originator" value={document.originator} />
          <Field label="Reviewer" value={document.reviewer || "—"} />
          <Field label="Issued" value={shortDate(document.issued_date)} />
          <Field label="Due" value={shortDate(document.due_date)} />
          <Field label="Returned" value={shortDate(document.returned_date)} />
          <Field label="Transmittal" value={document.transmittal_no || "—"} />
        </dl>

        <div className="mt-4 border-t border-line pt-3">
          <div className="label mb-2">File</div>
          <div className="rounded-sm border border-line bg-raised px-2 py-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-ink-faint" />
              <div className="min-w-0">
                <div className="truncate font-mono text-[10px] text-ink-dim" title={document.file_name}>
                  {document.file_name}
                </div>
                <div className="text-[10px] text-ink-faint">
                  {document.format} · {(document.file_size_kb / 1024).toFixed(1)} MB
                </div>
              </div>
            </div>
          </div>
        </div>

        {document.notes ? (
          <p className="mt-3 rounded-sm border border-warn/25 bg-warn-wash px-2 py-1.5 text-2xs text-warn">
            {document.notes}
          </p>
        ) : null}
      </div>
    </aside>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="label shrink-0">{label}</dt>
      <dd className="truncate text-right font-mono text-2xs text-ink-dim tabular" title={value}>
        {value}
      </dd>
    </div>
  );
}
