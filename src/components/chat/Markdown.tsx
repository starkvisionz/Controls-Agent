import type { ReactNode } from "react";

/**
 * A deliberately small markdown renderer.
 *
 * The agent emits a known, narrow subset — headings, bold, inline code, lists
 * and pipe tables — and this panel streams partial text on every frame. A full
 * parser would be both heavier than needed and slower to re-run per token.
 */

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "table"; headers: string[]; rows: string[][] }
  | { kind: "rule" };

const isTableRow = (line: string) => line.trim().startsWith("|") && line.trim().endsWith("|");
const isDivider = (line: string) => /^\|[\s:|-]+\|$/.test(line.trim());
const splitRow = (line: string) =>
  line.trim().slice(1, -1).split("|").map((c) => c.trim());

function parse(source: string): Block[] {
  const lines = source.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }

    // A table needs a header row and a divider row to be a table.
    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers, rows });
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items: string[] = [];
      while (i < lines.length) {
        const item = ordered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i])
          : /^\s*[-*]\s+(.*)$/.exec(lines[i]);
        if (item) {
          items.push(item[1]);
          i++;
        } else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length > 0) {
          // Continuation of the previous item.
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i++;
        } else {
          break;
        }
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    // Otherwise, gather consecutive lines into one paragraph.
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      paragraph.push(lines[i].trim());
      i++;
    }
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

/** Renders bold, italic and inline code within a line of text. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let n = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${n++}`;

    if (token.startsWith("**")) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      parts.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

/** Right-aligns cells that hold a figure so table columns read as numbers. */
const looksNumeric = (cell: string) => /^[-+$(]?[\d.,]+[%)a-zA-Z]*$/.test(cell.trim());

export function Markdown({ source }: { source: string }) {
  const blocks = parse(source);

  return (
    <div className="agent-prose text-xs leading-relaxed text-ink-dim">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "heading":
            return (
              <div key={i} className="label pt-1">
                {inline(block.text, `h${i}`)}
              </div>
            );

          case "rule":
            return <hr key={i} className="border-line" />;

          case "list":
            return block.ordered ? (
              <ol key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item, `l${i}-${j}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item, `l${i}-${j}`)}</li>
                ))}
              </ul>
            );

          case "table":
            return (
              <div key={i} className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      {block.headers.map((h, j) => (
                        <th key={j}>{inline(h, `th${i}-${j}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td
                            key={k}
                            className={looksNumeric(cell) ? "text-right font-mono tabular" : ""}
                          >
                            {inline(cell, `td${i}-${j}-${k}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          default:
            return <p key={i}>{inline(block.text, `p${i}`)}</p>;
        }
      })}
    </div>
  );
}
