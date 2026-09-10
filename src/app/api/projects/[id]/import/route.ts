import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/guard";
import { checkRate, tooManyRequests } from "@/lib/rate-limit";
import { getProject } from "@/lib/queries";
import { parseDelimited, TooLargeError } from "@/lib/import/csv";
import { readWorkbook } from "@/lib/import/workbook";
import { xerToTable } from "@/lib/import/schedule-import";
import { buildPlan } from "@/lib/import/plan";
import { commitPlan } from "@/lib/import/commit";
import { REGISTERS, type RegisterKey } from "@/lib/import/registers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Import, in two passes over the same file.
 *
 * `mode=preview` reports what would happen. `mode=commit` re-parses and
 * re-plans the file from scratch and then applies it — the client posts the
 * same file twice rather than posting back a plan it was given. That costs one
 * extra parse and buys the guarantee that what was approved and what is applied
 * are the same computation, not two that are hoped to agree. A client cannot
 * hand back an edited plan, because there is nowhere to hand one back to.
 */

/** Bigger than any register export, small enough that a parse cannot exhaust the box. */
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const url = new URL(req.url);
  const register = url.searchParams.get("register") as RegisterKey | null;
  const mode = url.searchParams.get("mode") === "commit" ? "commit" : "preview";

  if (!register || !(register in REGISTERS)) {
    return NextResponse.json(
      { error: `Unknown register. One of: ${Object.keys(REGISTERS).join(", ")}` },
      { status: 400 }
    );
  }

  const spec = REGISTERS[register];

  // The permission the register's own writes need — importing into the risk
  // register is editing the risk register, whatever the route it arrives by.
  const guard = requirePermission(req, spec.permission, id);
  if (!guard.ok) return guard.response;

  const gate = checkRate(req, "write", { identity: guard.principal.id });
  if (!gate.allowed) return tooManyRequests(gate.retryAfterSeconds);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is larger than ${Math.round(MAX_BYTES / 1024 / 1024)}MB` },
      { status: 413 }
    );
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const uploaded = form.get("file");
    if (uploaded instanceof File) file = uploaded;
  } catch {
    return NextResponse.json({ error: "Send the file as multipart form data" }, { status: 400 });
  }

  if (!file) return NextResponse.json({ error: "No file was attached" }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `That file is larger than ${Math.round(MAX_BYTES / 1024 / 1024)}MB` },
      { status: 413 }
    );
  }

  let rows: string[][];
  let format: string;
  let meta: Record<string, unknown> | undefined;

  try {
    const parsed = await parseFile(file, url.searchParams.get("sheet"));
    rows = parsed.rows;
    format = parsed.format;
    meta = parsed.meta;
  } catch (err) {
    const message =
      err instanceof TooLargeError
        ? err.message
        : err instanceof Error
          ? err.message
          : "That file could not be read";
    // 422 rather than 400: the request was well formed, its contents were not.
    return NextResponse.json({ error: message }, { status: 422 });
  }

  let plan;
  try {
    plan = buildPlan(register, id, rows);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "That file could not be mapped" },
      { status: 422 }
    );
  }

  if (mode === "preview") {
    return NextResponse.json({
      mode,
      format,
      meta,
      fileName: file.name,
      plan,
    });
  }

  const result = commitPlan(register, id, plan, guard.principal, {
    fileName: file.name,
    format,
  });

  return NextResponse.json({ mode, format, meta, fileName: file.name, plan, result });
}

async function parseFile(
  file: File,
  sheet: string | null
): Promise<{ rows: string[][]; format: string; meta?: Record<string, unknown> }> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) {
    const { rows, sheet: used, sheets } = await readWorkbook(await file.arrayBuffer(), sheet ?? undefined);
    return { rows, format: "Excel", meta: { sheet: used, sheets } };
  }

  // Everything else is text. Read it once and decide by shape rather than by
  // extension alone — an XER renamed .txt is still an XER.
  const text = await file.text();

  if (name.endsWith(".xer") || text.startsWith("ERMHDR")) {
    const { rows, meta } = xerToTable(text);
    return { rows, format: "P6 XER", meta: meta as unknown as Record<string, unknown> };
  }

  if (name.endsWith(".xml")) {
    // Recognised so the message can say what to do, rather than failing as a
    // CSV with one enormous column.
    throw new Error(
      "MS Project XML is not supported yet. Export the schedule as a P6 XER, or save the " +
        "activity list as CSV."
    );
  }

  const { rows, separator } = parseDelimited(text);
  return {
    rows,
    format: separator === "\t" ? "Tab-separated" : "CSV",
  };
}
