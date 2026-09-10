/**
 * RFC 4180 CSV, parsed here rather than pulled in.
 *
 * The format is small enough to own — quoted fields, doubled quotes inside
 * them, separators and newlines inside quotes — and this runs on uploaded
 * files, so the code that touches them is worth being able to read in full.
 *
 * Tabs are handled by the same parser: a .tsv or a P6 clipboard paste is CSV
 * with a different separator, and pretending otherwise means two parsers that
 * disagree about quoting.
 */

export type ParsedTable = { rows: string[][]; separator: string };

/** Row and cell ceilings, so a malformed or hostile file cannot exhaust memory. */
export const MAX_ROWS = 20_000;
export const MAX_COLUMNS = 200;

export class TooLargeError extends Error {}

/**
 * Guesses the separator from the header line.
 *
 * Counted outside quotes only — a comma inside "Piping, mechanical" is not a
 * vote for commas, and header rows are where that mistake shows up most.
 */
function detectSeparator(text: string): string {
  const firstLine = readLine(text);
  const counts = [",", "\t", ";", "|"].map((sep) => ({
    sep,
    n: countOutsideQuotes(firstLine, sep),
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].sep : ",";
}

function readLine(text: string): string {
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) return text.slice(0, i);
  }
  return text;
}

function countOutsideQuotes(line: string, sep: string): number {
  let inQuotes = false;
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === sep) n++;
  }
  return n;
}

export function parseDelimited(text: string, separator?: string): ParsedTable {
  // A UTF-8 BOM in front of the first header turns "Code" into "﻿Code",
  // which then matches no column. Excel writes one by default.
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const sep = separator ?? detectSeparator(body);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    row.push(field);
    field = "";
    if (row.length > MAX_COLUMNS) {
      throw new TooLargeError(`A row has more than ${MAX_COLUMNS} columns`);
    }
  };

  const endRow = () => {
    endField();
    // Skip rows that are entirely empty — trailing newlines, and the blank
    // spacer rows people leave between blocks in a spreadsheet.
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
    if (rows.length > MAX_ROWS) throw new TooLargeError(`More than ${MAX_ROWS} rows`);
  };

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (inQuotes) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === sep) {
      endField();
    } else if (ch === "\n") {
      endRow();
    } else if (ch === "\r") {
      // CRLF: the \n does the work. A lone \r (old Mac) ends the row too.
      if (body[i + 1] !== "\n") endRow();
    } else {
      field += ch;
    }
  }

  // Whatever is left when the file ends without a trailing newline.
  if (field !== "" || row.length > 0) endRow();

  return { rows, separator: sep };
}
