import { z } from "zod";
import {
  documentPatchSchema,
  isoDate,
  riskPatchSchema,
  taskPatchSchema,
  changeOrderPatchSchema,
} from "@/lib/validation";

/**
 * What each register accepts from a spreadsheet, and how a column finds its
 * field.
 *
 * The field schemas are the ones the API already enforces — imported rows go
 * through exactly the same validation as a typed edit, because a value that is
 * nonsense through the inspector is nonsense from a workbook too. The import
 * adds only the matching rule: which column identifies the row, and which
 * columns may be written.
 */

export type RegisterKey = "tasks" | "risks" | "documents" | "change-orders";

export type RegisterSpec = {
  key: RegisterKey;
  label: string;
  table: string;
  /** Permission needed to import into it — the same one the register's writes need. */
  permission: "schedule:write" | "risk:write" | "document:write" | "cost:write";
  /** Columns that identify an existing row, in order of preference. */
  match: { field: string; label: string; aliases: string[] }[];
  /** Everything else the import may set. */
  fields: { field: string; label: string; aliases: string[] }[];
  /** The row's human reference, for the preview and the audit entry. */
  labelOf: (row: Record<string, unknown>) => string;
  patchSchema: z.ZodTypeAny;
};

/** Header text reduced to something two spellings of the same thing share. */
export function normaliseHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")     // "Budget (USD)" and "Budget" are one column
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const TASK_FIELDS = [
  { field: "percent_complete", label: "Percent complete", aliases: ["percent complete", "pct complete", "progress", "complete", "physical percent complete", "phys complete"] },
  { field: "status", label: "Status", aliases: ["status", "activity status"] },
  { field: "forecast_start", label: "Forecast start", aliases: ["forecast start", "start", "early start", "actual start"] },
  { field: "forecast_finish", label: "Forecast finish", aliases: ["forecast finish", "finish", "early finish", "actual finish", "end"] },
  { field: "total_float_days", label: "Total float", aliases: ["total float", "float", "slack", "total float days"] },
  { field: "notes", label: "Notes", aliases: ["notes", "comment", "comments", "remarks"] },
];

const RISK_FIELDS = [
  { field: "probability", label: "Probability", aliases: ["probability", "likelihood", "p"] },
  { field: "impact", label: "Impact", aliases: ["impact", "consequence", "i"] },
  { field: "status", label: "Status", aliases: ["status", "risk status"] },
  { field: "response_strategy", label: "Response", aliases: ["response", "strategy", "response strategy", "treatment"] },
  { field: "mitigation_progress", label: "Mitigation progress", aliases: ["mitigation progress", "mitigation", "progress"] },
  { field: "owner", label: "Owner", aliases: ["owner", "risk owner", "responsible"] },
  { field: "cost_impact", label: "Cost impact", aliases: ["cost impact", "cost", "exposure", "value"] },
];

const DOCUMENT_FIELDS = [
  { field: "status", label: "Status", aliases: ["status", "issue status", "doc status"] },
  { field: "review_status", label: "Review status", aliases: ["review status", "review", "client code", "review code"] },
  { field: "issued_date", label: "Issued", aliases: ["issued", "issued date", "date issued", "transmitted"] },
  { field: "returned_date", label: "Returned", aliases: ["returned", "returned date", "date returned"] },
  { field: "due_date", label: "Due", aliases: ["due", "due date", "required date"] },
  { field: "reviewer", label: "Reviewer", aliases: ["reviewer", "reviewed by"] },
  { field: "transmittal_no", label: "Transmittal", aliases: ["transmittal", "transmittal no", "transmittal number"] },
];

const CHANGE_FIELDS = [
  { field: "status", label: "Status", aliases: ["status", "co status"] },
  { field: "cost_impact", label: "Cost impact", aliases: ["cost impact", "value", "amount", "cost"] },
  { field: "percent_complete", label: "Work performed", aliases: ["percent complete", "progress", "work performed"] },
  { field: "schedule_impact_days", label: "Schedule impact", aliases: ["schedule impact", "days", "time impact", "eot"] },
  { field: "submitted_date", label: "Submitted", aliases: ["submitted", "submitted date", "date submitted"] },
  { field: "decision_date", label: "Decided", aliases: ["decided", "decision date", "date decided", "approved date"] },
  { field: "owner", label: "Owner", aliases: ["owner", "responsible"] },
  { field: "client_ref", label: "Client reference", aliases: ["client ref", "client reference", "vo number", "client no"] },
];

export const REGISTERS: Record<RegisterKey, RegisterSpec> = {
  tasks: {
    key: "tasks",
    label: "Activities",
    table: "tasks",
    permission: "schedule:write",
    match: [{ field: "code", label: "Activity ID", aliases: ["activity id", "id", "code", "activity code", "task code", "task id"] }],
    fields: TASK_FIELDS,
    labelOf: (row) => String(row.code ?? ""),
    patchSchema: taskPatchSchema,
  },
  risks: {
    key: "risks",
    label: "Risks",
    table: "risks",
    permission: "risk:write",
    match: [{ field: "code", label: "Risk ID", aliases: ["risk id", "id", "code", "risk code", "ref"] }],
    fields: RISK_FIELDS,
    labelOf: (row) => String(row.code ?? ""),
    patchSchema: riskPatchSchema,
  },
  documents: {
    key: "documents",
    label: "Documents",
    table: "documents",
    permission: "document:write",
    // Two columns, because a document number identifies a deliverable and a
    // revision identifies which issue of it — matching on the number alone
    // would write rev C's review code onto rev A.
    match: [
      { field: "doc_number", label: "Document number", aliases: ["document number", "doc number", "document no", "doc no", "number", "id"] },
      { field: "revision", label: "Revision", aliases: ["revision", "rev"] },
    ],
    fields: DOCUMENT_FIELDS,
    labelOf: (row) => `${row.doc_number ?? ""} rev ${row.revision ?? ""}`,
    patchSchema: documentPatchSchema,
  },
  "change-orders": {
    key: "change-orders",
    label: "Change orders",
    table: "change_orders",
    permission: "cost:write",
    match: [{ field: "code", label: "Reference", aliases: ["reference", "ref", "co", "co number", "code", "id", "change order"] }],
    fields: CHANGE_FIELDS,
    labelOf: (row) => String(row.code ?? ""),
    patchSchema: changeOrderPatchSchema,
  },
};

/** A date column that arrived as something other than YYYY-MM-DD. */
export const looseDate = isoDate;
