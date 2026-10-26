// A change to a body is a list of tagged ops (#al-diff-cli, #werk-cli-propose). The body cuts into
// blocks at blank lines outside a code fence (#al-diff-cli-cover-block). Every block must be the
// old of an op (#al-diff-cli-cover), an old that quotes no real block is never trusted, and the
// new body is rebuilt from the ops alone, in their order.

export type Op =
  | { tag: "elaborated"; old: string; new: string }
  | { tag: "new"; new: string }
  | { tag: "removed"; old: string };

export const OP_TAGS = ["elaborated", "new", "removed"] as const;

/** One part of the diff of a body. `unquoted` marks an old that is not a block of the body. */
export type DiffPart =
  | { mark: "kept"; text: string }
  | { mark: "elaborated"; old: string; new: string }
  | { mark: "new"; new: string }
  | { mark: "removed"; old: string; unquoted?: true };

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** The blocks of a body, each trimmed at both ends. A blank line inside a fence does not cut. */
export function blocksOf(body: string | undefined): string[] {
  const blocks: string[] = [];
  let lines: string[] = [];
  let fence: string | undefined;
  const cut = () => {
    const block = lines.join("\n").trim();
    if (block !== "") blocks.push(block);
    lines = [];
  };
  for (const line of (body ?? "").split("\n")) {
    const marker = FENCE.exec(line)?.[1];
    if (fence === undefined && marker !== undefined) fence = marker;
    else if (fence !== undefined && marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length)
      fence = undefined;
    if (fence === undefined && line.trim() === "") cut();
    else lines.push(line);
  }
  cut();
  return blocks;
}

/** For each op, the index of the block its old quotes, or -1. Each block is quoted once, in op order. */
function quotes(body: string | undefined, ops: Op[]): number[] {
  const blocks = blocksOf(body);
  const taken = blocks.map(() => false);
  return ops.map((op) => {
    if (op.tag === "new") return -1;
    const at = blocks.findIndex((block, i) => !taken[i] && block === op.old.trim());
    if (at !== -1) taken[at] = true;
    return at;
  });
}

/** The blocks of the body that no op names as its old: the blocks an accept would lose unseen. */
export function uncovered(body: string | undefined, ops: Op[]): string[] {
  const quoted = new Set(quotes(body, ops));
  return blocksOf(body).filter((_, i) => !quoted.has(i));
}

/** The diff of the ops against the body, in the order of the ops. */
export function diffOf(body: string | undefined, ops: Op[]): DiffPart[] {
  const at = quotes(body, ops);
  return ops.flatMap((op, i): DiffPart[] => {
    if (op.tag === "new") return [{ mark: "new", new: op.new.trim() }];
    if (at[i] === -1) {
      const removed: DiffPart = { mark: "removed", old: op.old.trim(), unquoted: true };
      return op.tag === "removed" ? [removed] : [removed, { mark: "new", new: op.new.trim() }];
    }
    if (op.tag === "removed") return [{ mark: "removed", old: op.old.trim() }];
    if (op.old.trim() === op.new.trim()) return [{ mark: "kept", text: op.new.trim() }];
    return [{ mark: "elaborated", old: op.old.trim(), new: op.new.trim() }];
  });
}

/** The new body: the new text of each op, in order, one blank line apart. */
export function applyOps(body: string | undefined, ops: Op[]): string {
  const texts = diffOf(body, ops).flatMap((part) =>
    part.mark === "kept" ? [part.text] : part.mark === "removed" ? [] : [part.new],
  );
  return texts.filter((text) => text !== "").join("\n\n");
}

/** The rule a value breaks as an op list, or undefined when it is one. */
export function opsRule(value: unknown): string | undefined {
  if (!Array.isArray(value)) return "the ops are a list";
  for (const [i, op] of value.entries()) {
    const n = i + 1;
    if (typeof op !== "object" || op === null || !OP_TAGS.includes(op.tag))
      return `op ${n} is an object with a tag: ${OP_TAGS.join(", ").replace(/, (?=[^,]*$)/, " or ")}`;
    if (op.tag !== "removed" && typeof op.new !== "string") return `op ${n}, ${op.tag}, needs its new text`;
    if (op.tag !== "new" && typeof op.old !== "string") return `op ${n}, ${op.tag}, needs its old text`;
  }
  return undefined;
}
