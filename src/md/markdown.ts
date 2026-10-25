/**
 * The one Markdown renderer for card bodies, whys, notes and chat. Every piece of text is escaped
 * before a rule runs on it, so script in a card shows as text (#werk-progress). A card reference
 * links only when the map knows the id (#werk-reflink, #werk-reflink-inview, #werk-reflink-guard).
 */
import { escapeHtml } from "./escape.ts";
import { grammarFor, highlight } from "./highlight.ts";

/** Whether the map can open the card with this id now. A ghost can be opened, a removed card cannot. */
export type Known = (id: string) => boolean;

const MARK = "\u0000";
const REF = /(?<![\w/#:&-])(?<!&#38;)(#?)([A-Za-z0-9][A-Za-z0-9._:-]*)/g;
const SAFE_HREF = /^(?:https?:\/\/|mailto:|\/|#)/i;

function cardHref(id: string): string {
  return `/map/${encodeURIComponent(id)}`;
}

/** The label of a card reference, linked or, in a tile, shown only. */
function refHtml(id: string, link: boolean, inner = `#${id}`): string {
  return link
    ? `<a class="card-ref" href="${cardHref(id)}">${inner}</a>`
    : `<span class="card-ref">${inner}</span>`;
}

/** The longest known id that the token holds once trailing punctuation is cut off, or null. */
function resolveRef(
  token: string,
  hashed: boolean,
  known: Known,
): string | null {
  let id = token;
  while (id !== "") {
    if (known(id) && (hashed || /[-:]/.test(id))) return id;
    if (!/[.:_-]$/.test(id)) return null;
    id = id.slice(0, -1);
  }
  return null;
}

function inlineMarks(
  escaped: string,
  known: Known,
  link: boolean,
  stash: string[],
): string {
  const keep = (html: string) => `${MARK}${stash.push(html) - 1}${MARK}`;
  let s = escaped.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    const id = code.startsWith("#") ? code.slice(1) : code;
    if (/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id) && known(id)) {
      return keep(refHtml(id, link));
    }
    return keep(`<code>${code}</code>`);
  });
  s = s.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    (m, label: string, href: string) => {
      if (!SAFE_HREF.test(href)) return m;
      const text = inlineMarks(label, known, false, stash);
      return link ? keep(`<a href="${href}">${text}</a>`) : text;
    },
  );
  s = s.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "<del>$1</del>");
  s = s.replace(
    /(?<![*\w])\*(?![\s*])(.+?)(?<=[^\s*])\*(?!\*)/g,
    "<em>$1</em>",
  );
  s = s.replace(/(?<!\w)_(?!\s)(.+?)(?<=\S)_(?!\w)/g, "<em>$1</em>");
  return s.replace(REF, (m, hash: string, token: string) => {
    const id = resolveRef(token, hash === "#", known);
    if (id === null) return m;
    return refHtml(id, link) + (hash + token).slice(id.length + hash.length);
  });
}

function inline(text: string, known: Known, link: boolean): string {
  const stash: string[] = [];
  let out = inlineMarks(
    escapeHtml(text.replaceAll(MARK, "")),
    known,
    link,
    stash,
  );
  const holder = new RegExp(`${MARK}(\\d+)${MARK}`, "g");
  while (holder.test(out)) {
    out = out.replace(holder, (_m, n: string) => stash[Number(n)] ?? "");
  }
  return out;
}

/** The inline marks of a text, with a card reference linked. For a why line or a note. */
export function renderInline(text: string, known: Known): string {
  return inline(text, known, true);
}

/** The same inline marks, with a card reference shown and not linked, for a grid tile (#werk-reflink). */
export function renderTile(text: string, known: Known): string {
  return inline(text, known, false);
}

/** A card title: a backtick span shows as code, and nothing else is marked (#vi-title-code). */
export function renderTitle(title: string): string {
  return escapeHtml(title).replace(/`([^`\n]+)`/g, "<code>$1</code>");
}

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^(#{1,6})\s+(.+)$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

function codeBox(tag: string, code: string): string {
  const label =
    tag === "" ? "" : `<span class="code-tag">${escapeHtml(tag)}</span>`;
  const grammar = grammarFor(tag);
  const cls = grammar === null ? "" : ` class="lang-${grammar}"`;
  return `<div class="code-box">${label}<pre><code${cls}>${highlight(code, tag)}</code></pre></div>`;
}

function startsBlock(line: string): boolean {
  return (
    line.trim() === "" ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    ITEM.test(line)
  );
}

function blocks(lines: readonly string[], known: Known): string {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const heading = HEADING.exec(line);
    if (line.trim() === "") {
      i += 1;
    } else if (heading) {
      const level = (heading[1] ?? "#").length;
      out.push(
        `<h${level}>${inline(heading[2] ?? "", known, true)}</h${level}>`,
      );
      i += 1;
    } else if (RULE.test(line)) {
      out.push("<hr>");
      i += 1;
    } else if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i] ?? "")) {
        inner.push(QUOTE.exec(lines[i] ?? "")?.[1] ?? "");
        i += 1;
      }
      out.push(`<blockquote>${blocks(inner, known)}</blockquote>`);
    } else if (ITEM.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length) {
        const item = ITEM.exec(lines[i] ?? "");
        if (!item || /^\s*\d/.test(lines[i] ?? "") !== ordered) break;
        let text = item[2] ?? "";
        i += 1;
        while (
          i < lines.length &&
          /^\s+\S/.test(lines[i] ?? "") &&
          !ITEM.test(lines[i] ?? "")
        ) {
          text += `\n${(lines[i] ?? "").trim()}`;
          i += 1;
        }
        items.push(`<li>${inline(text, known, true)}</li>`);
      }
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.join("")}</${tag}>`);
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        (para.length === 0 || !startsBlock(lines[i] ?? ""))
      ) {
        para.push(lines[i] ?? "");
        i += 1;
      }
      out.push(`<p>${inline(para.join("\n"), known, true)}</p>`);
    }
  }
  return out.join("");
}

/**
 * The text as HTML blocks. Fences are split out first, so no inline rule runs inside code, and a
 * fence that is not closed runs to the end of the text, so a reply renders while it streams.
 */
export function renderMarkdown(text: string, known: Known): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  const flush = () => {
    out.push(blocks(prose, known));
    prose = [];
  };
  let i = 0;
  while (i < lines.length) {
    const open = FENCE.exec(lines[i] ?? "");
    if (!open) {
      prose.push(lines[i] ?? "");
      i += 1;
      continue;
    }
    flush();
    const marker = open[1] ?? "```";
    const code: string[] = [];
    i += 1;
    while (i < lines.length) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(lines[i] ?? "");
      if (
        close &&
        close[1]?.[0] === marker[0] &&
        (close[1]?.length ?? 0) >= marker.length
      )
        break;
      code.push(lines[i] ?? "");
      i += 1;
    }
    i += 1;
    out.push(codeBox(open[2] ?? "", code.join("\n")));
  }
  flush();
  return out.join("");
}
