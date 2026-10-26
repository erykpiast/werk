// The Markdown renderer for card text, notes and chat messages (#werk-progress, #werk-reflink).
// Pure: text in, safe HTML out. Fenced blocks are split out first, so no inline rule runs inside
// code, and a fence with no closing line still renders while a reply streams. All other text is
// HTML-escaped before any rule runs.

import { escapeHtml } from "./escape";
import { codeBlock } from "./highlight";
import { codeSpanRef, type KnownIds, linkRefs, refLabel, refLink } from "./reflink";

export type { KnownIds } from "./reflink";

const FENCE_OPEN = /^ {0,3}```\s*([^\s`]*)[^`]*$/;
const FENCE_CLOSE = /^ {0,3}```\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const QUOTE = /^ {0,3}&gt;\s?/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;
// A piece of finished HTML set aside while the inline rules run, by its index. The text itself
// may hold the two private-use marks, so they become entities first and only keep() makes them.
const PLACEHOLDER = /\uE000(\d+)\uE001/g;
const MARKS = /[\uE000\uE001]/g;
const SAFE_URL = /^(?:https?:|mailto:|\/|#|\.)/i;

type Inline = {
  /** Links and images render as anchors and images; off, they show as their text. */
  links: boolean;
  /** How a reference renders; undefined leaves every reference as written. */
  ref: ((id: string) => string) | undefined;
};

/** Card text as block HTML: paragraphs, headings, lists, quotes, rules and boxed code. */
export function renderMarkdown(text: string, known: KnownIds): string {
  const out: string[] = [];
  let prose: string[] = [];
  let fence: { tag: string; lines: string[] } | undefined;
  const flushProse = (): void => {
    out.push(blocks(escapeHtml(prose.join("\n")).split("\n"), known));
    prose = [];
  };
  const flushFence = (open: { tag: string; lines: string[] }): void => {
    out.push(codeBlock(open.lines.join("\n"), open.tag));
    fence = undefined;
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (fence !== undefined) {
      if (FENCE_CLOSE.test(line)) {
        flushFence(fence);
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open !== null) {
      flushProse();
      fence = { tag: open[1] ?? "", lines: [] };
      continue;
    }
    prose.push(line);
  }
  flushProse();
  if (fence !== undefined) flushFence(fence);
  return out.filter((html) => html !== "").join("\n");
}

/** One line of inline Markdown for a tile: it is a link itself, so nothing inside it links (#vi-onview-subcards). */
export function renderTileInline(text: string, known: KnownIds): string {
  return inline(escapeHtml(text.replace(/\s+/g, " ").trim()), known, { links: false, ref: refLabel });
}

/** Escaped prose lines as block HTML. */
function blocks(lines: string[], known: KnownIds): string {
  const out: string[] = [];
  const body: Inline = { links: true, ref: refLink };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      const level = heading[1]?.length ?? 1;
      // A heading is left alone: no reference inside it links (#werk-reflink).
      out.push(`<h${level}>${inline(heading[2] ?? "", known, { links: true, ref: undefined })}</h${level}>`);
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) {
        quoted.push((lines[i] ?? "").replace(QUOTE, ""));
        i += 1;
      }
      out.push(`<blockquote>${blocks(quoted, known)}</blockquote>`);
      continue;
    }
    const list = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : undefined;
    if (list !== undefined) {
      const items: string[] = [];
      const start = NUMBERED.exec(line)?.[1];
      while (i < lines.length) {
        const item = list.exec(lines[i] ?? "");
        if (item === null) break;
        items.push(`<li>${inline(item[item.length - 1] ?? "", known, body)}</li>`);
        i += 1;
      }
      const tag = list === BULLET ? "ul" : "ol";
      const from = start !== undefined && Number(start) !== 1 ? ` start="${Number(start)}"` : "";
      out.push(`<${tag}${from}>${items.join("")}</${tag}>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && isParagraphLine(lines[i] ?? "")) {
      para.push(inline((lines[i] ?? "").trim(), known, body));
      i += 1;
    }
    out.push(`<p>${para.join("<br>")}</p>`);
  }
  return out.join("\n");
}

function isParagraphLine(line: string): boolean {
  return (
    line.trim() !== "" &&
    !HEADING.test(line) &&
    !RULE.test(line) &&
    !QUOTE.test(line) &&
    !BULLET.test(line) &&
    !NUMBERED.test(line)
  );
}

/** Escaped text with inline Markdown rendered. */
function inline(escaped: string, known: KnownIds, opts: Inline): string {
  escaped = escaped.replace(MARKS, (mark) => `&#x${mark.charCodeAt(0).toString(16).toUpperCase()};`);
  const stash: string[] = [];
  const keep = (html: string): string => {
    stash.push(html);
    return `\uE000${stash.length - 1}\uE001`;
  };
  // A code span that names a card renders as a reference, except inside a link label, where a
  // second link would nest in the first. The label puts back the plain code form.
  const plainCode = new Map<string, string>();
  let text = escaped.replace(/`([^`]+)`/g, (_match, content: string) => {
    const code = `<code>${content}</code>`;
    const id = codeSpanRef(content, known);
    if (opts.ref === undefined || id === undefined) return keep(code);
    const placeholder = keep(opts.ref(id));
    plainCode.set(placeholder, code);
    return placeholder;
  });
  const asLabel = (label: string): string =>
    emphasis(
      label.replace(PLACEHOLDER, (match) => {
        const code = plainCode.get(match);
        return code === undefined ? match : keep(code);
      }),
    );
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt: string, src: string) => {
    if (!opts.links) return keep(alt);
    // An attribute holds plain text only: an address with stashed HTML in it stays as written,
    // and the alt keeps the text of its code spans and references without their tags.
    if (!isSafeUrl(src)) return match;
    return keep(`<img src="${src}" alt="${restore(alt, stash).replace(/<[^>]*>/g, "")}">`);
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    if (!opts.links) return keep(asLabel(label));
    return isSafeUrl(href) ? keep(`<a href="${href}">${asLabel(label)}</a>`) : match;
  });
  const ref = opts.ref;
  if (ref !== undefined) text = linkRefs(text, known, (id) => keep(ref(id)));
  text = emphasis(text);
  return restore(text, stash);
}

/** An address that may become an attribute: a safe scheme (#werk-progress-safe-links), no stashed HTML. */
function isSafeUrl(url: string): boolean {
  return SAFE_URL.test(url) && !url.includes("\uE000");
}

function emphasis(text: string): string {
  return text
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
    .replace(/\*([^\s*](?:[^*]*?[^\s*])?)\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_([^\s_](?:[^_]*?[^\s_])?)_(?!\w)/g, "$1<em>$2</em>");
}

/** Put each stashed piece back. A piece may hold another, as a link label holds a code span. */
function restore(text: string, stash: string[]): string {
  return text.replace(PLACEHOLDER, (_match, n: string) => restore(stash[Number(n)] ?? "", stash));
}
