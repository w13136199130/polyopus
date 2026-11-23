import { Fragment, type ReactNode } from "react";
import styles from "./MarkdownView.module.css";

/** Safe, dependency-free Markdown renderer for artifact/report previews.
 * Supports headings, paragraphs, lists, blockquotes, fenced code, tables,
 * bold/italic, inline code and links. Raw HTML is never interpreted. */

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "quote"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "rule" };

function splitTable(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.includes("-");
}

function parse(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      const lang = fence[1].trim();
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: "code", lang, text: body.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({
        kind: "heading", level: heading[1].length, text: heading[2].trim(),
      });
      index += 1;
      continue;
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quote });
      continue;
    }

    if (line.trim().startsWith("|") && index + 1 < lines.length
      && isSeparator(lines[index + 1])) {
      const header = splitTable(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        rows.push(splitTable(lines[index]));
        index += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*[-*+]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ kind: "list", ordered: false, items });
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*\d+[.)]\s+(.+)$/);
        if (!match) break;
        items.push(match[1]);
        index += 1;
      }
      blocks.push({ kind: "list", ordered: true, items });
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index];
      if (!next.trim()) break;
      if (/^(#{1,6})\s+/.test(next) || /^\s*[-*+]\s+/.test(next)
        || /^\s*\d+[.)]\s+/.test(next) || /^\s*>\s?/.test(next)
        || /^\s*```/.test(next) || next.trim().startsWith("|")) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

function safeHref(value: string): string | null {
  const url = value.trim();
  if (/^(https?:|mailto:|#|\/)/i.test(url)) return url;
  return null;
}

function inline(text: string, keyPrefix = "i"): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("`")) {
      parts.push(<code key={key} className={styles.inlineCode}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const href = safeHref(link[2]);
        parts.push(href
          ? <a key={key} href={href} target="_blank" rel="noreferrer">{link[1]}</a>
          : <span key={key}>{link[1]}</span>);
      } else {
        parts.push(token);
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function Inline({ text }: { text: string }) {
  return <>{inline(text)}</>;
}

function BlockView({ block, index }: { block: Block; index: number }) {
  if (block.kind === "heading") {
    const Tag = `h${Math.min(3, block.level)}` as "h1" | "h2" | "h3";
    return <Tag className={styles[`h${Math.min(3, block.level)}`]}>{inline(block.text, `h${index}`)}</Tag>;
  }
  if (block.kind === "paragraph") {
    return <p className={styles.p}><Inline text={block.text} /></p>;
  }
  if (block.kind === "quote") {
    return (
      <blockquote className={styles.quote}>
        {block.lines.map((line, row) => <p key={row}><Inline text={line} /></p>)}
      </blockquote>
    );
  }
  if (block.kind === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag className={styles.list}>
        {block.items.map((item, row) => (
          <li key={row}><Inline text={item} /></li>
        ))}
      </Tag>
    );
  }
  if (block.kind === "code") {
    return (
      <pre className={styles.code} data-testid="markdown-code">
        {block.lang ? <span className={styles.lang}>{block.lang}</span> : null}
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.kind === "table") {
    return (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {block.header.map((cell, col) => (
                <th key={col}><Inline text={cell} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, line) => (
              <tr key={line}>
                {block.header.map((_, col) => (
                  <td key={col}><Inline text={row[col] ?? ""} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <hr className={styles.rule} />;
}

export function MarkdownView({ content }: { content: string }) {
  const blocks = parse(content);
  return (
    <div className={styles.root} data-testid="markdown-view">
      {blocks.map((block, index) => (
        <Fragment key={index}>
          <BlockView block={block} index={index} />
        </Fragment>
      ))}
    </div>
  );
}
