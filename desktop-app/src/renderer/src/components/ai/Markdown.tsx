import type { ReactNode } from "react";

/**
 * Markdown for LLM answers (chat, NL query), rendered as React elements:
 * never as HTML, so model output cannot inject markup or script.
 *
 * Covers what chat models actually write: headings, paragraphs, bullet and
 * numbered lists (nested by indentation), block quotes, fenced code, rules,
 * GFM tables, and inline bold, italic, strikethrough, code and links.
 * Links render as their text with the URL as tooltip: the renderer may not
 * navigate, and there is no bridge to open external pages.
 */

// --- Inline -----------------------------------------------------------------

const INLINE_RULES: Array<{
  re: RegExp;
  render: (m: RegExpExecArray, key: string) => ReactNode;
}> = [
  {
    re: /`([^`\n]+)`/,
    render: (m, key) => (
      <code
        key={key}
        className="rounded bg-background/70 px-1 font-mono text-[0.85em]"
      >
        {m[1]}
      </code>
    ),
  },
  {
    // The content may hold *italic* spans, so "**a *b***" nests correctly.
    re: /\*\*(?=\S)((?:\*[^*\n]+\*|[^*])+?)(?<=\S)\*\*|__(?=\S)([\s\S]*?\S)__/,
    render: (m, key) => (
      <strong key={key} className="font-semibold">
        {renderInline(m[1] ?? m[2], key)}
      </strong>
    ),
  },
  {
    re: /~~(?=\S)([\s\S]*?\S)~~/,
    render: (m, key) => <s key={key}>{renderInline(m[1], key)}</s>,
  },
  {
    // `_x_` only between non-word characters, so snake_case stays as is.
    re: /\*(?=[^\s*])([^*\n]*?[^\s*])\*|(?<![\p{L}\p{N}_])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}_])/u,
    render: (m, key) => <em key={key}>{renderInline(m[1] ?? m[2], key)}</em>,
  },
  {
    re: /\[([^\]\n]+)\]\(([^)\s]+)\)/,
    render: (m, key) => (
      <span key={key} className="underline decoration-dotted" title={m[2]}>
        {renderInline(m[1], key)}
      </span>
    ),
  },
];

/** Inline formatting of one line or cell. */
function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    let best: {
      m: RegExpExecArray;
      rule: (typeof INLINE_RULES)[number];
    } | null = null;
    for (const rule of INLINE_RULES) {
      const m = rule.re.exec(rest);
      if (m && (!best || m.index < best.m.index)) best = { m, rule };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.rule.render(best.m, `${keyPrefix}.${n++}`));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

// --- Blocks -----------------------------------------------------------------

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  | { kind: "table"; header: string[]; rows: string[][] };

interface ListItem {
  text: string;
  children: Block[];
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*(```|~~~)/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function indentOf(line: string): number {
  return line.match(/^\s*/)?.[0].replace(/\t/g, "    ").length ?? 0;
}

function listMarker(
  line: string,
): { indent: number; ordered: boolean; start: number; text: string } | null {
  const numbered = NUMBERED.exec(line);
  if (numbered) {
    return {
      indent: indentOf(line),
      ordered: true,
      start: Number(numbered[2]),
      text: numbered[3],
    };
  }
  const bullet = BULLET.exec(line);
  if (bullet && !RULE.test(line)) {
    return {
      indent: indentOf(line),
      ordered: false,
      start: 1,
      text: bullet[2],
    };
  }
  return null;
}

/** Parses a list starting at `i`; returns the block and the next line index. */
function parseList(lines: string[], i: number): [Block, number] {
  const first = listMarker(lines[i])!;
  const base = first.indent;
  const items: ListItem[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      // A blank line ends the list unless the next line continues it.
      const next = lines[i + 1];
      const marker = next != null ? listMarker(next) : null;
      if (marker && marker.indent >= base && marker.ordered === first.ordered) {
        i++;
        continue;
      }
      break;
    }
    const marker = listMarker(line);
    if (marker && marker.indent === base && marker.ordered === first.ordered) {
      items.push({ text: marker.text, children: [] });
      i++;
      continue;
    }
    if (marker && marker.indent > base && items.length > 0) {
      const [nested, next] = parseList(lines, i);
      items[items.length - 1].children.push(nested);
      i = next;
      continue;
    }
    if (!marker && indentOf(line) > base && items.length > 0) {
      // Continuation line of the current item.
      items[items.length - 1].text += ` ${line.trim()}`;
      i++;
      continue;
    }
    break;
  }
  return [
    { kind: "list", ordered: first.ordered, start: first.start, items },
    i,
  ];
}

function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      // An unclosed fence (still streaming) runs to the end.
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) {
        body.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    if (line.includes("|") && TABLE_SEPARATOR.test(lines[i + 1] ?? "")) {
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(cells(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }
    if (listMarker(line)) {
      const [list, next] = parseList(lines, i);
      blocks.push(list);
      i = next;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", lines: quote });
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !HEADING.test(lines[i]) &&
      !FENCE.test(lines[i]) &&
      !listMarker(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !RULE.test(lines[i]) &&
      !(lines[i].includes("|") && TABLE_SEPARATOR.test(lines[i + 1] ?? ""))
    ) {
      paragraph.push(lines[i].trim());
      i++;
    }
    blocks.push({ kind: "paragraph", lines: paragraph });
  }
  return blocks;
}

// --- Rendering --------------------------------------------------------------

function lines(parts: string[], key: string): ReactNode[] {
  return parts.flatMap((part, i) => [
    ...(i > 0 ? [<br key={`${key}.br${i}`} />] : []),
    ...renderInline(part, `${key}.${i}`),
  ]);
}

const HEADING_CLASS = [
  "text-base font-semibold",
  "text-sm font-semibold",
  "text-sm font-semibold",
  "text-sm font-medium",
  "text-sm font-medium",
  "text-sm font-medium",
];

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = `h${Math.min(block.level + 1, 6)}` as "h2";
      return (
        <Tag key={key} className={`mt-2 ${HEADING_CLASS[block.level - 1]}`}>
          {renderInline(block.text, key)}
        </Tag>
      );
    }
    case "paragraph":
      return <p key={key}>{lines(block.lines, key)}</p>;
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={`${key}.${i}`}>
          {renderInline(item.text, `${key}.${i}`)}
          {item.children.map((child, j) =>
            renderBlock(child, `${key}.${i}.${j}`),
          )}
        </li>
      ));
      return block.ordered ? (
        <ol
          key={key}
          start={block.start}
          className="ml-5 list-decimal space-y-0.5"
        >
          {items}
        </ol>
      ) : (
        <ul key={key} className="ml-5 list-disc space-y-0.5">
          {items}
        </ul>
      );
    }
    case "quote":
      return (
        <blockquote
          key={key}
          className="border-l-2 border-border pl-3 text-muted-foreground"
        >
          {lines(block.lines, key)}
        </blockquote>
      );
    case "code":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded bg-background/70 p-2 font-mono text-xs"
        >
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr key={key} className="border-border" />;
    case "table":
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    className="border-b border-border px-2 py-1 text-left font-semibold"
                  >
                    {renderInline(cell, `${key}.h${i}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className="border-b border-border/50 px-2 py-1 align-top"
                    >
                      {renderInline(cell, `${key}.${r}.${c}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {parseBlocks(text).map((block, i) => renderBlock(block, `b${i}`))}
    </div>
  );
}
