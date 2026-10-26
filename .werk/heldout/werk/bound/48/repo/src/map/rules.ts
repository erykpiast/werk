// The map rules, in one place (#pr-log-refuse). A write checks each of its events here before it
// appends, and the fold checks each committed line here before it applies it. `check` returns the
// rule that the event breaks, or undefined when the event may apply.
import { type Op, opsRule, uncovered } from "./ops.ts";
import { removalHolding } from "./removal.ts";
import { childrenOf, findLink, isAncestor, linksFrom, parentOf } from "./tree.ts";
import {
  type Event,
  type ExcerptFields,
  type FoldedMap,
  KILL_FORMS,
  type KillCriterion,
  LINK_TYPES,
  type Link,
  type MapNode,
  NODE_KINDS,
  type NodeFields,
  type Proposal,
  STATUSES,
  WHOS,
} from "./types.ts";

type Rule = string | undefined;

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";
const optionalText = (value: unknown) => value === undefined || typeof value === "string";

function fieldsRule(fields: NodeFields): Rule {
  if (!isText(fields.id)) return "a node needs an id";
  if (!NODE_KINDS.includes(fields.kind)) return `a node's kind is one of ${NODE_KINDS.join(", ")}`;
  if (!isText(fields.title)) return "a node needs a title";
  if (fields.status !== undefined && !STATUSES.includes(fields.status))
    return `a status is one of ${STATUSES.join(", ")}`;
  if (fields.who !== undefined && !WHOS.includes(fields.who)) return `who is one of ${WHOS.join(", ")}`;
  for (const key of ["why", "body", "why_not", "url", "finding"] as const) {
    if (!optionalText(fields[key])) return `a node's ${key} is text`;
  }
  return undefined;
}

function nodeOf(map: FoldedMap, id: unknown): MapNode | undefined {
  return typeof id === "string" ? map.nodes.get(id) : undefined;
}

/** Why the map holds no node `id`: it is out with a removal, or it was never there (#werk-write-remove-links-new-write-refuses). */
function missing(map: FoldedMap, id: unknown): string {
  const holder = typeof id === "string" ? removalHolding(map, id) : undefined;
  if (holder === undefined) return `unknown node #${String(id)}`;
  return `#${String(id)} is removed${holder === id ? "" : ` with #${holder}`}; restore #${holder} first`;
}

/** The rule a new refines link from `child` to `parent` breaks: one parent, no loop, no real card under a ghost. */
function placeRule(map: FoldedMap, child: MapNode | NodeFields, parent: MapNode, childIsGhost: boolean): Rule {
  if (child.kind !== "card" || parent.kind !== "card") return "refines links a card to a card";
  if (child.id === parent.id || isAncestor(map, child.id, parent.id))
    return `no cycle: #${parent.id} already sits below #${child.id}`;
  const current = parentOf(map, child.id);
  if (current !== undefined && current !== parent.id)
    return `one parent per card: #${child.id} already refines #${current}`;
  if (!childIsGhost && parent.proposed)
    return `a real card cannot sit under a ghost: #${parent.id} is proposed and not accepted`;
  return undefined;
}

function addNodeRule(map: FoldedMap, fields: NodeFields & { parent?: string }, ghost: boolean): Rule {
  const broken = fieldsRule(fields);
  if (broken !== undefined) return broken;
  const existing = map.nodes.get(fields.id);
  if (existing?.proposed)
    return `a ghost's words are frozen: #${fields.id} is proposed; discard it and propose it again`;
  if (existing !== undefined) return `#${fields.id} already exists`;
  // The log still holds the old card's events under a removed id (#werk-write-remove-links).
  const holder = removalHolding(map, fields.id);
  if (holder !== undefined)
    return `#${fields.id} is removed, and its id stays taken; restore #${holder} to bring it back`;
  if (fields.parent === undefined) return undefined;
  const parent = nodeOf(map, fields.parent);
  if (parent === undefined) return missing(map, fields.parent);
  return placeRule(map, fields, parent, ghost);
}

const isPosition = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** The rule a quote breaks: a new excerpt id, a citing card, and a pointer whose span holds the words (#werk-excerpt-event). */
function quoteRule(map: FoldedMap, payload: ExcerptFields & { card: string }): Rule {
  const broken = addNodeRule(map, { id: payload.id, kind: "excerpt", title: payload.title }, true);
  if (broken !== undefined) return broken;
  const card = nodeOf(map, payload.card);
  if (card === undefined) return `unknown node #${String(payload.card)}`;
  if (card.kind !== "card") return "supported_by links a card to a source or an excerpt";
  for (const key of ["conversation", "session", "speaker", "said_at"] as const) {
    if (!isText(payload[key])) return `an excerpt's pointer needs its ${key}`;
  }
  const { message, start, end } = payload;
  if (!isPosition(message) || !isPosition(start) || !isPosition(end))
    return "an excerpt's message, start and end are positions from zero";
  if (end - start !== payload.title.length) return "an excerpt's span is as long as its words";
  return undefined;
}

function linkRule(map: FoldedMap, link: Link): Rule {
  if (!LINK_TYPES.includes(link.type)) return `a link's type is one of ${LINK_TYPES.join(", ")}`;
  const from = nodeOf(map, link.from);
  const to = nodeOf(map, link.to);
  if (from === undefined) return missing(map, link.from);
  if (to === undefined) return missing(map, link.to);
  if (from.id === to.id) return "a node cannot link to itself";
  if (from.kind === "option" && link.type !== "alternative_to") return "an option has only alternative_to links";
  if (to.kind === "option") return "an option has only alternative_to links, from the option to its card";
  switch (link.type) {
    case "refines":
      return placeRule(map, from, to, from.proposed);
    case "depends_on":
      if (from.kind !== "card" || to.kind !== "card") return "depends_on links a card to a card";
      if (!isText(link.why)) return "a depends_on link needs a reason: what the card takes from the other card";
      if (isAncestor(map, to.id, from.id))
        return `a depends_on link cannot point to an ancestor: #${to.id} is above #${from.id}`;
      if (isAncestor(map, from.id, to.id))
        return `a depends_on link cannot point to a descendant: #${to.id} is below #${from.id}`;
      return undefined;
    case "supported_by":
      if (from.kind !== "card" || (to.kind !== "source" && to.kind !== "excerpt"))
        return "supported_by links a card to a source or an excerpt";
      return undefined;
    case "alternative_to": {
      if (from.kind !== "option" || to.kind !== "card") return "alternative_to links an option to a card";
      const current = linksFrom(map, from.id, "alternative_to")[0];
      if (current !== undefined && current.to !== to.id)
        return `an option has one alternative_to link: #${from.id} is already an option of #${current.to}`;
      return undefined;
    }
  }
}

function ghostRule(map: FoldedMap, id: unknown, verb: "accept" | "discard"): Rule {
  const node = nodeOf(map, id);
  if (node === undefined) return missing(map, id);
  if (!node.proposed) return pendingRule(node, verb);
  if (verb === "discard") return undefined;
  const parent = nodeOf(map, parentOf(map, node.id));
  if (parent?.proposed) return `a real card cannot sit under a ghost: #${parent.id} is proposed and not accepted`;
  return undefined;
}

/**
 * The rule an accept or a discard of a real node's pending change breaks (#al-diff-cli). The body
 * can change after the proposal, so an accept checks the cover rule again (#al-diff-cli-cover).
 */
function pendingRule(node: MapNode, verb: "accept" | "discard"): Rule {
  const { pending } = node;
  if (pending === undefined)
    return `only a ghost or a pending change can be ${verb}ed: #${node.id} is real and has no pending change`;
  if (verb === "discard" || pending.ops === undefined) return undefined;
  return coverRule(node, pending.ops);
}

/** The rule a proposal breaks: a real node, some change, a title, and an op list that names every block. */
function proposeRule(map: FoldedMap, payload: Proposal & { id: string }): Rule {
  const broken = wordsRule(map, payload.id);
  if (broken !== undefined) return broken;
  const { title, why, ops } = payload;
  if (title === undefined && why === undefined && ops === undefined)
    return "a proposal changes the title, the why or the body";
  if (title !== undefined && !isText(title)) return "a node needs a title";
  if (!optionalText(why)) return "a node's why is text";
  if (ops === undefined) return undefined;
  const shape = opsRule(ops);
  if (shape !== undefined) return shape;
  const node = map.nodes.get(payload.id);
  return node === undefined ? undefined : coverRule(node, ops);
}

/** The rule an op list breaks when a block of the body is the old of no op (#al-diff-cli-cover). */
function coverRule(node: MapNode, ops: Op[]): Rule {
  const lost = uncovered(node.body, ops);
  if (lost.length === 0) return undefined;
  const blocks = lost.map((block) => block.replace(/^(?=.)/gm, "    ")).join("\n\n");
  return (
    `every block of the body of #${node.id} must be the old of an elaborated or removed op; ` +
    `${lost.length === 1 ? "this block is" : "these blocks are"} at risk:\n${blocks}`
  );
}

function wordsRule(map: FoldedMap, id: unknown): Rule {
  const node = nodeOf(map, id);
  if (node === undefined) return missing(map, id);
  if (node.kind === "excerpt") return `an excerpt's words never change: #${node.id} holds the words its quote matched`;
  if (node.proposed) return `a ghost's words are frozen: #${node.id} is proposed; discard it and propose it again`;
  return undefined;
}

/** A removal names a card in the map. A reparent moves the children to the card's parent, so it needs one. */
function removeRule(map: FoldedMap, id: unknown, reparent: unknown): Rule {
  const node = nodeOf(map, id);
  if (node === undefined) return missing(map, id);
  if (node.kind !== "card")
    return `a removal names a card: #${node.id} is a${node.kind === "option" || node.kind === "excerpt" ? "n" : ""} ${node.kind}, and it goes with its card`;
  if (reparent !== undefined && typeof reparent !== "boolean") return "reparent is true or false";
  if (reparent === true && childrenOf(map, node.id).length > 0 && parentOf(map, node.id) === undefined)
    return `a reparent moves the children up to the card's parent, and #${node.id} has none`;
  return undefined;
}

/**
 * A restore names the card its removal named. A node that went out with another card comes back
 * only with that card, and no card comes back under a parent that is still out (#werk-remove-restore-undo).
 */
function restoreRule(map: FoldedMap, id: unknown): Rule {
  if (typeof id !== "string") return "a restore names a card";
  const removal = map.removals.get(id);
  if (removal === undefined) {
    if (map.nodes.has(id)) return `#${id} is in the map, not removed`;
    return missing(map, id);
  }
  const parent = map.waiting.find((link) => link.from === id && link.type === "refines")?.to;
  if (parent !== undefined && !map.nodes.has(parent))
    return `#${id} sits under #${parent}, which is out of the map: ${missing(map, parent)}`;
  return undefined;
}

/** The rule a record on `id` breaks: who, a waiver, a kill criterion and the decide are a card's alone. */
function cardRule(map: FoldedMap, id: unknown): Rule {
  const node = nodeOf(map, id);
  if (node === undefined) return missing(map, id);
  if (node.kind !== "card")
    return `only a card carries who, waivers, kill criteria and a decide: #${node.id} is of kind ${node.kind}`;
  return undefined;
}

const RECORDS = ["who", "no_basis", "unchallenged"];
const WAIVED_FACT = { no_basis: "basis", unchallenged: "option" } as const;

function editRule(map: FoldedMap, payload: { id: string } & Record<string, unknown>): Rule {
  const broken = cardRule(map, payload.id);
  if (broken !== undefined) return broken;
  const keys = Object.keys(payload).filter((key) => key !== "id");
  if (keys.length === 0) return "an edit sets who or records a waiver";
  const stray = keys.find((key) => !RECORDS.includes(key));
  if (stray !== undefined) return `an edit sets only ${RECORDS.join(", ")}, not ${stray}`;
  if (payload.who !== undefined && !WHOS.includes(payload.who as never)) return `who is one of ${WHOS.join(", ")}`;
  for (const [key, fact] of Object.entries(WAIVED_FACT)) {
    const reason = payload[key];
    if (reason !== undefined && !(typeof reason === "string" && reason.trim() !== ""))
      return `a waiver needs a written reason: the ${fact} waiver of #${payload.id} has none`;
  }
  return undefined;
}

/** The words each form of a kill criterion needs (#kill-shape). */
const KILL_WORDS: Record<KillCriterion["form"], string[]> = {
  metric: ["metric", "source", "threshold", "window"],
  manual: ["test"],
  "no-metric": ["reason"],
  revisit: [],
};

function killRule(map: FoldedMap, payload: { id: string; criterion: unknown }): Rule {
  const broken = cardRule(map, payload.id);
  if (broken !== undefined) return broken;
  const criterion = payload.criterion as Record<string, unknown> | null;
  if (typeof criterion !== "object" || criterion === null || !KILL_FORMS.includes(criterion.form as never))
    return `a kill criterion's form is one of ${KILL_FORMS.join(", ")}`;
  const words = KILL_WORDS[criterion.form as KillCriterion["form"]];
  const missing = words.find((word) => !(typeof criterion[word] === "string" && criterion[word].trim() !== ""));
  if (missing !== undefined) return `a ${String(criterion.form)} kill criterion needs its ${missing}`;
  return undefined;
}

function decideRule(map: FoldedMap, id: unknown): Rule {
  const broken = cardRule(map, id);
  if (broken !== undefined) return broken;
  return map.nodes.get(id as string)?.status === "decided" ? `#${String(id)} is already decided` : undefined;
}

/** The rule that `event` breaks against `map`, or undefined when it may apply. */
export function check(map: FoldedMap, event: Event): Rule {
  const payload = event.payload as unknown;
  if (typeof payload !== "object" || payload === null) return "an event needs a payload";
  switch (event.type) {
    case "node.added":
    case "node.proposed":
      // Only a quote creates an excerpt, so its words always have a transcript match (#werk-excerpt-event).
      if (event.payload.kind === "excerpt") return "only a quote creates an excerpt";
      return addNodeRule(map, event.payload, event.type === "node.proposed");
    case "excerpt.quoted":
      return quoteRule(map, event.payload);
    case "node.retitled":
      return wordsRule(map, event.payload.id) ?? (isText(event.payload.title) ? undefined : "a node needs a title");
    case "node.bodyEdited":
      return wordsRule(map, event.payload.id);
    case "node.decided":
      return decideRule(map, event.payload.id);
    case "node.edited":
      return editRule(map, event.payload);
    case "kill.added":
      return killRule(map, event.payload);
    case "edge.added":
      return linkRule(map, event.payload);
    case "edge.removed":
      return findLink(map, event.payload) === undefined
        ? `no ${String(event.payload.type)} link from #${String(event.payload.from)} to #${String(event.payload.to)}`
        : undefined;
    case "change.proposed":
      return proposeRule(map, event.payload);
    case "change.accepted":
      return ghostRule(map, event.payload.id, "accept");
    case "change.discarded":
      return ghostRule(map, event.payload.id, "discard");
    case "node.removed":
      return removeRule(map, event.payload.id, event.payload.reparent);
    case "node.restored":
      return restoreRule(map, event.payload.id);
    case "note.added":
      // Any node takes a note, an excerpt too (#werk-cli-notes).
      if (nodeOf(map, event.payload.id) === undefined) return missing(map, event.payload.id);
      return isText(event.payload.text) ? undefined : "a note needs text";
    default:
      return `unknown event type ${String((event as { type: unknown }).type)}`;
  }
}
