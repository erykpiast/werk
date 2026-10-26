// The text of `werk show`: one node with its status, who, parent, waivers, kill criteria and links
// (#werk-cli-show, #werk-contract-waiver-reason), its thread of notes (#werk-cli-notes), and
// the lines that report what the fold set aside (#pr-log-refuse).

import { formatThread } from "./notes.ts";
import { type DiffPart, diffOf } from "./ops.ts";
import { allLinks, isLive, parentOf } from "./tree.ts";
import type { FoldedMap, KillCriterion, Link, MapNode, Problem } from "./types.ts";

/** The title of a node in the map or out of it. */
export function titleOf(map: FoldedMap, id: string): string {
  return (map.nodes.get(id) ?? map.removed.get(id))?.title ?? "";
}

function linkLine(map: FoldedMap, link: Link, self: string): string[] {
  const outgoing = link.from === self;
  const other = outgoing ? link.to : link.from;
  const ghost = map.nodes.get(other)?.proposed === true;
  const mark = isLive(map, link) ? "" : ghost ? "  (ghost, held)" : "  (held)";
  const lines = [`  ${outgoing ? "->" : "<-"} ${link.type.padEnd(15)} ${other}  ${titleOf(map, other)}${mark}`];
  if (link.why !== undefined) lines.push(`       why: ${link.why}`);
  return lines;
}

/** One kill criterion in plain words (#kill-shape). */
export function describeKill(criterion: KillCriterion): string {
  switch (criterion.form) {
    case "metric":
      return `metric: ${criterion.metric}, from ${criterion.source}, threshold ${criterion.threshold}, window ${criterion.window}`;
    case "manual":
      return `manual test: ${criterion.test}`;
    case "no-metric":
      return `no metric: ${criterion.reason}`;
    case "revisit":
      return "revisit at any time";
  }
}

const removed = (text: string) => `[-${text}-]`;
const added = (text: string) => `{+${text}+}`;

/** One part of a body diff: removed text in [- -], added text in {+ +}, kept text plain (#al-diff). */
function diffText(part: DiffPart): string {
  switch (part.mark) {
    case "kept":
      return part.text;
    case "elaborated":
      return removed(part.old) + added(part.new);
    case "new":
      return added(part.new);
    case "removed":
      return part.unquoted ? `${removed(part.old)}  (not a block of the body)` : removed(part.old);
  }
}

/** The pending change of a node as one diff of its title, why and body, never a before and an after. */
export function formatPending(node: MapNode): string[] {
  const { pending } = node;
  if (pending === undefined) return [];
  const lines = ["pending change:"];
  if (pending.title !== undefined) lines.push(`  title: ${removed(node.title)}${added(pending.title)}`);
  if (pending.why !== undefined)
    lines.push(`  why: ${node.why === undefined ? "" : removed(node.why)}${added(pending.why)}`);
  if (pending.ops !== undefined) {
    const parts = diffOf(node.body, pending.ops).map((part) => diffText(part).replace(/^(?=.)/gm, "    "));
    lines.push("  body:", parts.join("\n\n"));
  }
  return lines;
}

/** The printed node, or undefined when the map has no node `id`. */
export function formatNode(map: FoldedMap, id: string): string | undefined {
  const node = map.nodes.get(id);
  if (node === undefined) return undefined;
  const lines = [
    `${node.kind} ${node.id}  [${node.status}]${node.proposed ? "  proposed" : ""}${node.pending ? "  pending change" : ""}`,
    node.title,
  ];
  if (node.why !== undefined) lines.push(`why: ${node.why}`);
  if (node.who !== undefined) lines.push(`who: ${node.who}`);
  const parent = parentOf(map, id);
  if (parent !== undefined) lines.push(`parent: ${parent}  ${titleOf(map, parent)}`);
  // A waiver prints with its reason, so it never reads as a forgotten fact (#werk-contract-waiver-reason).
  if (node.no_basis !== undefined) lines.push(`basis waived: ${node.no_basis}`);
  if (node.unchallenged !== undefined) lines.push(`option waived: ${node.unchallenged}`);
  if (node.kill !== undefined) {
    lines.push("kill criteria:", ...node.kill.map((criterion, i) => `  ${i + 1}. ${describeKill(criterion)}`));
  }
  if (node.why_not !== undefined) lines.push(`why not: ${node.why_not}`);
  if (node.url !== undefined) lines.push(`url: ${node.url}`);
  if (node.finding !== undefined) lines.push(`finding: ${node.finding}`);
  if (node.body !== undefined) lines.push("", node.body);
  if (node.pending !== undefined) lines.push("", ...formatPending(node));
  const every = allLinks(map);
  const links = [...every.filter((link) => link.from === id), ...every.filter((link) => link.to === id)];
  if (links.length > 0) lines.push("", ...links.flatMap((link) => linkLine(map, link, id)));
  const thread = formatThread(map.threads.get(id) ?? []);
  if (thread.length > 0) lines.push("", ...thread);
  return `${lines.join("\n")}\n`;
}

/** One line per log line that the fold set aside. */
export function formatProblems(problems: Problem[]): string {
  return problems.map((problem) => `werk: log line ${problem.line} set aside: ${problem.rule}\n`).join("");
}

/** The result of an accept or a discard: the node named, then each node that went with it. */
export function stagedLines(map: FoldedMap, id: string, ids: string[], verb: string): string {
  const rest = ids.filter((each) => each !== id).map((each) => `  and ${each}  ${titleOf(map, each)}\n`);
  return `${id}: ${verb}\n${rest.join("")}`;
}
