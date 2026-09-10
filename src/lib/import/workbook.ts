import ExcelJS from "exceljs";
import { MAX_COLUMNS, MAX_ROWS, TooLargeError } from "./csv";

/**
 * Excel, reduced to the same shape a CSV parses to.
 *
 * Everything downstream works on `string[][]`, so a workbook is turned into
 * rows here and the library never leaves this file. That keeps one mapping and
 * planning path for both formats rather than two that drift.
 *
 * On the choice of library: the `xlsx` package on npm is pinned at 0.18.5 with
 * two unfixed high-severity advisories — prototype pollution and a ReDoS — in
 * its parsing code, which is precisely the path an uploaded file takes. ExcelJS
 * carries no high-severity advisory; its one moderate is a transitive `uuid`
 * bounds check that only applies when the caller supplies a buffer, which
 * nothing here does.
 */

/**
 * A percentage-formatted cell holds its value as a fraction.
 *
 * Excel shows 60% and stores 0.6. Reading the stored number straight through
 * turns a progress column into hundredths of a percent, silently — a claim of
 * 60% complete imports as 0.6% and the earned value collapses. The number
 * format is the only thing that distinguishes it from a genuine 0.6.
 */
function isPercentFormat(numFmt: string | undefined): boolean {
  if (!numFmt) return false;
  // A literal % inside quotes is a label, not a format code.
  return numFmt.replace(/"[^"]*"/g, "").includes("%");
}

/** Formatted text for a cell, or "" — never a formula, an object, or null. */
function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    // Excel dates arrive as Date objects in UTC. ISO, because every schema in
    // `validation.ts` expects YYYY-MM-DD and will say so if it does not get it.
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "object") {
    // Formulas carry their last computed result; hyperlinks and rich text carry
    // the text somebody actually sees. Reading the formula instead would import
    // "=SUM(B2:B9)" as a value.
    if ("result" in value && value.result !== undefined && value.result !== null) {
      return cellText(value.result as ExcelJS.CellValue);
    }
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("hyperlink" in value && typeof value.hyperlink === "string") return value.hyperlink;
    if ("error" in value) return "";
    return "";
  }

  return String(value);
}

/**
 * Reads the first worksheet, or the one named.
 *
 * Only the first sheet by default: a controls workbook usually has the register
 * on sheet one and notes, lookups or a pivot behind it, and importing those
 * would be worse than importing nothing.
 */
export async function readWorkbook(
  buffer: ArrayBuffer,
  sheetName?: string
): Promise<{ rows: string[][]; sheet: string; sheets: string[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheets = workbook.worksheets.map((w) => w.name);
  if (sheets.length === 0) throw new Error("That workbook has no sheets");

  const worksheet = sheetName
    ? workbook.worksheets.find((w) => w.name === sheetName)
    : workbook.worksheets[0];

  if (!worksheet) {
    throw new Error(`No sheet named "${sheetName}". This workbook has: ${sheets.join(", ")}`);
  }

  if (worksheet.rowCount > MAX_ROWS) {
    throw new TooLargeError(`That sheet has ${worksheet.rowCount} rows; the limit is ${MAX_ROWS}`);
  }

  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    // `row.values` is 1-based with a leading hole, which is why this counts
    // rather than mapping.
    const width = Math.min(row.cellCount, MAX_COLUMNS);
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c);
      const text = cellText(cell.value).trim();

      if (typeof cell.value === "number" && isPercentFormat(cell.numFmt)) {
        // Rounded to four places: 0.6 * 100 is 60.00000000000001 in binary
        // floating point, and that lands in the audit diff as written.
        cells.push(String(Math.round(cell.value * 100 * 10_000) / 10_000));
      } else {
        cells.push(text);
      }
    }
    if (cells.some((cell) => cell !== "")) rows.push(cells);
  });

  return { rows, sheet: worksheet.name, sheets };
}
