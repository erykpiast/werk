/**
 * A pending change drawn inside its card: added words have a blue highlight, removed words have
 * a blue highlight and a strikethrough, and no before or after section exists (#al-diff-render).
 * A list pairs its old and new items one by one, so only a changed item is marked.
 * A block that changes kind shows the old block removed and the new block added.
 */
import {
  type CheckedOp,
  type Segment,
  wordSegments,
} from "../map/edit-diff.ts";
import { escapeHtml } from "../md/escape.ts";
import { renderInline, renderMarkdown } from "../md/markdown.ts";

type Known = (id: string) => boolean;
type Render = (text: string) => string;

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const ORDERED = /^\s*\d+[.)]\s+/;

const mark = (kind: "add" | "del", html: string, block = false): string =>
  `<${kind === "add" ? "ins" : "del"} class="diff-${kind}${block ? " diff-block" : ""}">${html}</${kind === "add" ? "ins" : "del"}>`;

/** Shared words plain, added words highlighted, removed words highlighted and struck. */
export function diffInline(
  before: string,
  after: string,
  render: Render,
): string {
  const html = (run: Segment) => render(run.text);
  return wordSegments(before, after)
    .map((run) =>
      run.kind === "same"
        ? html(run)
        : mark(run.kind === "added" ? "add" : "del", html(run)),
    )
    .join(" ");
}

type Shape = "ul" | "ol" | "heading" | "code" | "paragraph";

function shapeOf(block: string): Shape {
  const first = block.split("\n")[0] ?? "";
  if (first.trim().startsWith("```")) return "code";
  if (/^#{1,6}\s/.test(first)) return "heading";
  if (ORDERED.test(first)) return "ol";
  if (ITEM.test(first)) return "ul";
  return "paragraph";
}

/** The items of a list block, each without its marker. A line with no marker continues the item above. */
function itemsOf(block: string): string[] {
  const items: string[] = [];
  for (const line of block.split("\n")) {
    if (ITEM.test(line) || items.length === 0)
      items.push(line.replace(ITEM, ""));
    else items[items.length - 1] += ` ${line.trim()}`;
  }
  return items;
}

type Pair = { old?: string; new?: string };

/** Items kept as they are anchor the rest; between two anchors the old and new items pair by position. */
function pairItems(before: string[], after: string[]): Pair[] {
  const rows: number[][] = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0),
  );
  const at = (i: number, j: number) => rows[i]?.[j] ?? 0;
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      (rows[i] as number[])[j] =
        before[i] === after[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  const pairs: Pair[] = [];
  let oldRun: string[] = [];
  let newRun: string[] = [];
  const flush = () => {
    const count = Math.max(oldRun.length, newRun.length);
    for (let k = 0; k < count; k++) {
      const pair: Pair = {};
      if (k < oldRun.length) pair.old = oldRun[k] as string;
      if (k < newRun.length) pair.new = newRun[k] as string;
      pairs.push(pair);
    }
    oldRun = [];
    newRun = [];
  };
  let i = 0;
  let j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      flush();
      pairs.push({ old: before[i], new: after[j] });
      i++;
      j++;
    } else if (
      j >= after.length ||
      (i < before.length && at(i + 1, j) >= at(i, j + 1))
    ) {
      oldRun.push(before[i++] as string);
    } else {
      newRun.push(after[j++] as string);
    }
  }
  flush();
  return pairs;
}

function listDiff(
  tag: "ul" | "ol",
  before: string,
  after: string,
  render: Render,
): string {
  const rows = pairItems(itemsOf(before), itemsOf(after)).map((pair) => {
    if (pair.old !== undefined && pair.new !== undefined) {
      return `<li>${pair.old === pair.new ? render(pair.new) : diffInline(pair.old, pair.new, render)}</li>`;
    }
    return pair.new !== undefined
      ? `<li>${mark("add", render(pair.new))}</li>`
      : `<li>${mark("del", render(pair.old as string))}</li>`;
  });
  return `<${tag}>${rows.join("")}</${tag}>`;
}

/** One kept or reworded block: marked inside when the kind holds, else the old block removed and the new added. */
function changedBlock(before: string, after: string, known: Known): string {
  const render: Render = (text) => renderInline(text, known);
  const shape = shapeOf(before);
  if (shape === shapeOf(after)) {
    if (shape === "ul" || shape === "ol") {
      return listDiff(shape, before, after, render);
    }
    if (shape === "paragraph") {
      return `<p>${diffInline(before, after, render)}</p>`;
    }
    if (shape === "heading") {
      const level = /^#+/.exec(after)?.[0].length ?? 3;
      const text = (block: string) => block.replace(/^#+\s+/, "");
      return `<h${level}>${diffInline(text(before), text(after), render)}</h${level}>`;
    }
  }
  return (
    mark("del", renderMarkdown(before, known), true) +
    mark("add", renderMarkdown(after, known), true)
  );
}

/** The body of a pending change, block by block in the order of the ops. */
export function diffBody(ops: readonly CheckedOp[], known: Known): string {
  return ops
    .map((op) => {
      if (op.tag === "new") {
        return mark("add", renderMarkdown(op.new, known), true);
      }
      if (op.tag === "removed") {
        const html = renderMarkdown(op.old, known);
        return op.real
          ? mark("del", html, true)
          : `${mark("del", html, true)}<p class="diff-note">${escapeHtml("not a block of the body")}</p>`;
      }
      return op.old === op.new
        ? renderMarkdown(op.new, known)
        : changedBlock(op.old, op.new, known);
    })
    .join("");
}
