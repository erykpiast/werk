/**
 * The diff of a proposed edit: the tagged changes to a body, the check that they name
 * every block, and the plain-text marks. See #al-diff, #al-diff-cli, #al-diff-cli-cover,
 * #al-diff-cli-cover-block and #werk-cli-propose-text-diff.
 */

/** One tagged change as an agent sends it. */
export type Op =
  | { tag: "elaborated"; old: string; new: string }
  | { tag: "new"; new: string }
  | { tag: "removed"; old: string };

/** One change after its quote is checked. `real` is false when the old text is not a block of the body. */
export type CheckedOp =
  | { tag: "elaborated"; old: string; new: string }
  | { tag: "new"; new: string }
  | { tag: "removed"; old: string; real: boolean };

/** A body is its blocks, cut at each run of blank lines outside a code fence. */
export function splitBlocks(body: string): string[] {
  const blocks: string[] = [];
  let lines: string[] = [];
  let fenced = false;
  const flush = () => {
    const block = lines.join("\n").trim();
    if (block !== "") blocks.push(block);
    lines = [];
  };
  for (const line of body.split("\n")) {
    if (line.trim().startsWith("```")) fenced = !fenced;
    if (line.trim() === "" && !fenced) flush();
    else lines.push(line);
  }
  flush();
  return blocks;
}

/** The ops of a proposal, or the reason the value is not a list of ops. */
export function parseOps(value: unknown): Op[] | string {
  if (!Array.isArray(value)) return '"ops" must be a list';
  const ops: Op[] = [];
  for (const [index, raw] of value.entries()) {
    const at = `op ${index + 1}`;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return `${at} must be an object with a tag`;
    }
    const fields = raw as Record<string, unknown>;
    const text = (key: string) =>
      typeof fields[key] === "string" && (fields[key] as string).trim() !== "";
    const needs = (keys: string[]) => keys.find((key) => !text(key));
    switch (fields.tag) {
      case "elaborated": {
        const missing = needs(["old", "new"]);
        if (missing) return `${at} (elaborated) needs "${missing}" as text`;
        ops.push({
          tag: "elaborated",
          old: (fields.old as string).trim(),
          new: (fields.new as string).trim(),
        });
        break;
      }
      case "new": {
        if (!text("new")) return `${at} (new) needs "new" as text`;
        ops.push({ tag: "new", new: (fields.new as string).trim() });
        break;
      }
      case "removed": {
        if (!text("old")) return `${at} (removed) needs "old" as text`;
        ops.push({ tag: "removed", old: (fields.old as string).trim() });
        break;
      }
      default:
        return `${at} has the tag ${JSON.stringify(fields.tag)}; use elaborated, new or removed`;
    }
  }
  return ops;
}

export type Checked =
  | { ok: true; ops: CheckedOp[] }
  | { ok: false; atRisk: string[] };

/**
 * Matches each op's old text with one block of the body, each block once.
 * A block that no op names is at risk, and the check fails. An old text that quotes no
 * block is kept as a removal that is not real, with the new text of an elaboration as a new block.
 */
export function checkOps(body: string, ops: readonly Op[]): Checked {
  const unused = splitBlocks(body);
  const checked: CheckedOp[] = [];
  const claim = (old: string): boolean => {
    const at = unused.indexOf(old);
    if (at === -1) return false;
    unused.splice(at, 1);
    return true;
  };
  for (const op of ops) {
    if (op.tag === "new") checked.push(op);
    else if (op.tag === "removed") {
      checked.push({ tag: "removed", old: op.old, real: claim(op.old) });
    } else if (claim(op.old)) checked.push(op);
    else {
      checked.push({ tag: "removed", old: op.old, real: false });
      checked.push({ tag: "new", new: op.new });
    }
  }
  return unused.length > 0
    ? { ok: false, atRisk: unused }
    : { ok: true, ops: checked };
}

/** The body that the ops build: every block that is kept, reworded or new, in the order of the ops. */
export function applyOps(ops: readonly CheckedOp[]): string {
  return ops
    .flatMap((op) => (op.tag === "removed" ? [] : [op.new]))
    .join("\n\n");
}

/** The length of the longest run of shared words from each pair of positions. */
function lcsTable(a: string[], b: string[]): (i: number, j: number) => number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  const at = (i: number, j: number) => rows[i]?.[j] ?? 0;
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      (rows[i] as number[])[j] =
        a[i] === b[j]
          ? at(i + 1, j + 1) + 1
          : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }
  return at;
}

/** Old and new text as one line: removed words in [- -], added words in {+ +}, shared words plain. */
export function wordDiff(before: string, after: string): string {
  const a = before.split(/\s+/).filter((word) => word !== "");
  const b = after.split(/\s+/).filter((word) => word !== "");
  const shared = lcsTable(a, b);
  const parts: string[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const close = () => {
    if (removed.length > 0) parts.push(`[-${removed.join(" ")}-]`);
    if (added.length > 0) parts.push(`{+${added.join(" ")}+}`);
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close();
      parts.push(a[i] as string);
      i++;
      j++;
    } else if (
      j >= b.length ||
      (i < a.length && shared(i + 1, j) >= shared(i, j + 1))
    ) {
      removed.push(a[i++] as string);
    } else {
      added.push(b[j++] as string);
    }
  }
  close();
  return parts.join(" ");
}

/** The body of a pending change, block by block in the order of the ops. */
export function bodyDiff(ops: readonly CheckedOp[]): string[] {
  return ops.map((op) => {
    if (op.tag === "new") return `{+${op.new}+}`;
    if (op.tag === "removed") {
      return op.real
        ? `[-${op.old}-]`
        : `[-${op.old}-] (not a block of the body)`;
    }
    return op.old === op.new ? op.new : wordDiff(op.old, op.new);
  });
}

/** What a proposal holds. A missing field leaves that part of the card as it is. */
export type Pending = {
  title?: string;
  why?: string;
  ops?: CheckedOp[];
};

/** The lines of the pending-change section for a card with these words. Empty when nothing changes. */
export function renderPending(
  card: { title: string; why: string },
  pending: Pending,
): string[] {
  const lines = ["pending change:"];
  if (pending.title !== undefined) {
    lines.push(`  title: ${wordDiff(card.title, pending.title)}`);
  }
  if (pending.why !== undefined) {
    lines.push(`  why: ${wordDiff(card.why, pending.why)}`);
  }
  if (pending.ops !== undefined) {
    lines.push("  body:");
    for (const block of bodyDiff(pending.ops)) {
      lines.push(
        ...block.split("\n").map((line) => (line === "" ? "" : `    ${line}`)),
        "",
      );
    }
    lines.pop();
  }
  return lines;
}
