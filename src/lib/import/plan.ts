import { all } from "@/lib/db";
import { diffFields, type FieldChange } from "@/lib/audit";
import { toFieldErrors } from "@/lib/validation";
import { normaliseHeader, REGISTERS, type RegisterKey } from "./registers";

/**
 * Turning a parsed table into something somebody can approve.
 *
 * Nothing is written here. The plan is a full account of what *would* happen,
 * row by row, and the commit step re-derives it from the same file rather than
 * trusting a plan posted back — so what was approved and what is applied are
 * the same computation, not two that are hoped to agree.
 *
 * Rows that fail are reported, not dropped, and one bad row does not stop the
 * good ones: a progress claim with two typos in four hundred lines should
 * import three hundred and ninety-eight and tell you about the two.
 */

export type RowOutcome = "update" | "unchanged" | "not-found" | "invalid";

export type PlannedRow = {
  /** 1-based line in the source file, so an error can be pointed at. */
  line: number;
  label: string;
  outcome: RowOutcome;
  id?: string;
  changes: FieldChange[];
  errors: { field: string; message: string }[];
};

export type ImportPlan = {
  register: RegisterKey;
  registerLabel: string;
  /** Header text to the field it was matched to, for the mapping summary. */
  mapped: { column: string; field: string; label: string }[];
  ignored: string[];
  rows: PlannedRow[];
  counts: Record<RowOutcome, number>;
};

type Existing = Record<string, unknown> & { id: string };

/**
 * Values arrive as text from every source. This is the one place they become
 * the types the schemas expect — and the only place a percentage written as
 * "84%", a number written with thousands separators, or a date written
 * "31/07/2026" becomes usable, because that is what people's spreadsheets
 * actually hold.
 */
function coerce(field: string, raw: string): unknown {
  const text = raw.trim();
  if (text === "") return undefined;

  if (
    /_date$/.test(field) ||
    field.endsWith("_start") ||
    field.endsWith("_finish") ||
    field === "issued_date" ||
    field === "returned_date" ||
    field === "due_date"
  ) {
    return normaliseDate(text);
  }

  if (
    /percent|impact|float|probability|progress|days|cost|value|budget/.test(field) &&
    field !== "cost_account_id"
  ) {
    // Accountants write a negative in brackets, planners write a percentage
    // with a sign, and every export writes thousands separators.
    const negative = /^\(.*\)$/.test(text);
    const cleaned = text.replace(/[()%,\s]/g, "").replace(/^[^\d.+-]+/, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return text; // let the schema reject it by name
    return negative ? -n : n;
  }

  return text;
}

/**
 * Dates, in the orders people write them.
 *
 * Ambiguous day/month pairs are read day-first, which is what P6 and most of
 * the EPC world outside the US produce. An unambiguous ISO date always wins,
 * and anything unrecognisable is handed to the schema to reject by name rather
 * than guessed at.
 */
function normaliseDate(text: string): string {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

  const slashed = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (slashed) {
    const [, a, b, y] = slashed;
    const year = y.length === 2 ? `20${y}` : y;
    const first = Number(a);
    const second = Number(b);
    const pad = (n: number) => String(n).padStart(2, "0");

    // A number above 12 can only be a day, whatever the writer intended.
    if (first > 12 && second <= 12) return `${year}-${pad(second)}-${pad(first)}`;
    if (second > 12 && first <= 12) return `${year}-${pad(first)}-${pad(second)}`;
    return `${year}-${pad(second)}-${pad(first)}`;
  }

  // "31 Jul 2026" and similar.
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);

  return text;
}

export function buildPlan(register: RegisterKey, projectId: string, rows: string[][]): ImportPlan {
  const spec = REGISTERS[register];

  if (rows.length === 0) throw new Error("That file has no rows");

  const header = rows[0];
  const body = rows.slice(1);

  // Header to field. First match wins, so a sheet carrying both "Progress" and
  // "Percent complete" uses whichever appears first rather than silently
  // preferring one of them.
  const columns = new Map<number, { field: string; label: string }>();
  const ignored: string[] = [];
  const known = [...spec.match, ...spec.fields];

  header.forEach((raw, index) => {
    const key = normaliseHeader(raw);
    const hit = known.find(
      (candidate) => candidate.aliases.includes(key) || normaliseHeader(candidate.label) === key
    );
    const alreadyMapped = [...columns.values()].some((c) => c.field === hit?.field);

    if (hit && !alreadyMapped) columns.set(index, { field: hit.field, label: hit.label });
    else if (raw.trim() !== "") ignored.push(raw.trim());
  });

  const mappedFields = new Set([...columns.values()].map((c) => c.field));
  const missing = spec.match.filter((m) => !mappedFields.has(m.field)).map((m) => m.label);

  if (missing.length > 0) {
    throw new Error(
      `This file has no ${missing.join(" and ")} column, so its rows cannot be matched to ` +
        `existing records. Columns found: ${header.filter((h) => h.trim()).join(", ")}`
    );
  }

  // One read of the register, indexed by its natural key.
  const matchFields = spec.match.map((m) => m.field);
  const existingRows = all<Existing>(`SELECT * FROM ${spec.table} WHERE project_id = ?`, [projectId]);
  const index = new Map<string, Existing>();
  const keyOf = (source: Record<string, unknown>) =>
    matchFields.map((f) => String(source[f] ?? "").trim().toLowerCase()).join(" ");

  for (const row of existingRows) index.set(keyOf(row), row);

  const planned: PlannedRow[] = [];
  const seen = new Set<string>();

  body.forEach((cells, i) => {
    const line = i + 2; // 1-based, and the header is line 1

    const values: Record<string, unknown> = {};
    for (const [column, { field }] of columns) {
      const value = coerce(field, cells[column] ?? "");
      if (value !== undefined) values[field] = value;
    }

    const key = keyOf(values);
    const label = spec.labelOf(values) || `line ${line}`;

    if (matchFields.some((f) => !values[f])) {
      planned.push({
        line,
        label,
        outcome: "invalid",
        changes: [],
        errors: [{ field: spec.match[0].field, message: "this row has no identifier" }],
      });
      return;
    }

    // A file listing the same record twice is a file whose author lost track of
    // it. Importing both would apply whichever came last and say nothing.
    if (seen.has(key)) {
      planned.push({
        line,
        label,
        outcome: "invalid",
        changes: [],
        errors: [{ field: spec.match[0].field, message: "appears more than once in this file" }],
      });
      return;
    }
    seen.add(key);

    const existing = index.get(key);
    if (!existing) {
      // Import updates records; it does not create them. A row for something
      // this project has never heard of is far more often the wrong file or a
      // mistyped reference than a genuinely new record.
      planned.push({ line, label, outcome: "not-found", changes: [], errors: [] });
      return;
    }

    // The identifying columns are not writable — they are how the row was found.
    const patch: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(values)) {
      if (!matchFields.includes(field)) patch[field] = value;
    }

    const parsed = spec.patchSchema.safeParse(patch);
    if (!parsed.success) {
      planned.push({
        line,
        label,
        outcome: "invalid",
        changes: [],
        errors: toFieldErrors(parsed.error),
      });
      return;
    }

    const changes = diffFields(existing, parsed.data as Record<string, unknown>);
    planned.push({
      line,
      label,
      outcome: changes.length === 0 ? "unchanged" : "update",
      id: existing.id,
      changes,
      errors: [],
    });
  });

  const counts: Record<RowOutcome, number> = {
    update: 0,
    unchanged: 0,
    "not-found": 0,
    invalid: 0,
  };
  for (const row of planned) counts[row.outcome]++;

  return {
    register,
    registerLabel: spec.label,
    mapped: [...columns.entries()].map(([i, c]) => ({
      column: header[i]?.trim() ?? "",
      field: c.field,
      label: c.label,
    })),
    ignored,
    rows: planned,
    counts,
  };
}
