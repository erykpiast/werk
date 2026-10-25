/**
 * The fold: a pure function from the events of the log to the map. See #pr-log.
 * An event that breaks a map rule is not applied. The fold lists it as a problem
 * and the events after it still fold (#pr-log-refuse). A write checks its events
 * with the same step function, so the fold and a write never disagree.
 */

import { acceptChange, discardChange, proposeChange } from "./change-rules.ts";
import { applyKept, checkDecide } from "./contract.ts";
import type { Pending } from "./edit-diff.ts";
import { acceptGhost, discardGhost } from "./ghost-rules.ts";
import { checkLink } from "./link-rules.ts";
import { clearResumed } from "./mark-rules.ts";
import {
  applyQuoted,
  EXCERPT_ADD_REFUSAL,
  excerptFrozenDetail,
} from "./quote-rules.ts";
import { isOut, outRefusal, removeCard, restoreCard } from "./removal-rules.ts";
import { applyReopen } from "./reopen-rules.ts";
import { applyReview } from "./review-rules.ts";

export type Kind = "card" | "option" | "source" | "excerpt";
export type Who = "you" | "me" | "prototype";
export type Status = "open" | "proto" | "decided";
export type LinkType =
  | "refines"
  | "depends_on"
  | "supported_by"
  | "alternative_to";

export const KINDS: readonly Kind[] = ["card", "option", "source", "excerpt"];
export const WHOS: readonly Who[] = ["you", "me", "prototype"];
export const STATUSES: readonly Status[] = ["open", "proto", "decided"];
export const LINK_TYPES: readonly LinkType[] = [
  "refines",
  "depends_on",
  "supported_by",
  "alternative_to",
];

/** The reasons a reopen carries (#pr-wf-paused). A mark from an amend says "amended" instead. */
export const REOPEN_REASONS = ["postponed", "invalidated", "rejected"] as const;
export type ReopenReason = (typeof REOPEN_REASONS)[number];

/**
 * A stale, paused or postponed mark, derived in the order of the events (#pr-log-fold-marks).
 * `link` is the last hop from the marked card toward the origin, and `via` the cards between,
 * nearest to the origin first (#vi-prop-trace-reason). `trace` is the printed form.
 */
export type Mark = {
  kind: "stale" | "paused" | "postponed";
  origin: string;
  reason: ReopenReason | "amended";
  at: string;
  text: string;
  link: Edge | null;
  via: string[];
  trace: string;
};

/** One kill criterion: what must become true to revisit a decision (#kill-shape). */
export type Criterion =
  | {
      form: "metric";
      source: string;
      metric: string;
      threshold: string;
      window: string;
      sample: string;
    }
  | { form: "manual"; test: string }
  | { form: "no-metric"; reason: string }
  | { form: "revisit" };

/** The text fields each form of criterion needs, all non-empty. */
export const CRITERION_FIELDS: Record<Criterion["form"], readonly string[]> = {
  metric: ["source", "metric", "threshold", "window", "sample"],
  manual: ["test"],
  "no-metric": ["reason"],
  revisit: [],
};

/** Where an excerpt's words sit in a conversation (#werk-excerpt-pointer). `end` is exclusive. */
export type Pointer = {
  conversation: string;
  session: string;
  message: number;
  start: number;
  end: number;
  speaker: string;
  at: string;
};

export type MapNode = {
  id: string;
  kind: Kind;
  title: string;
  why: string;
  body: string;
  status: Status;
  who: Who | null;
  /** A ghost: proposed, in no rollup, with every edge of its own held. */
  proposed: boolean;
  marks: Mark[];
  /** The reason no basis applies, or null when none was waived (#werk-contract-waiver-reason). */
  noBasis: string | null;
  /** The reason no option was weighed, or null when none was waived. */
  unchallenged: string | null;
  kill: Criterion[];
  /** The latest proposed change to the title, the why or the body, until it is accepted or discarded. */
  pending: Pending | null;
  /** Set on an excerpt only. Its words are the title, and they never change (#werk-excerpt-event). */
  pointer?: Pointer;
};

export type Edge = { from: string; to: string; type: LinkType; why: string };

export type RuleName =
  | "bad-json"
  | "bad-event"
  | "duplicate-id"
  | "unknown-card"
  | "second-parent"
  | "cycle"
  | "option-link"
  | "link-why"
  | "lineage"
  | "not-ghost"
  | "accept-actor"
  | "frozen"
  | "cover"
  | "ghost-parent"
  | "excerpt"
  | "waiver"
  | "contract"
  | "reopen"
  | "review"
  | "remove-target"
  | "no-grandparent"
  | "not-removed"
  | "parent-out";

export type Violation = { rule: RuleName; detail: string };
export type Problem = Violation & { line: number };

/** One line of a card's thread: a note, or the marker where its id was proposed again. */
export type ThreadEntry = { line: number } & (
  | { kind: "note"; by: string; text: string }
  | { kind: "proposed-again" }
);

/**
 * One removal that is not undone. `nodes` is every node it took, the named card first.
 * `moved` lists the children that a reparent removal attached to the grandparent.
 */
export type Removal = {
  id: string;
  reparent: boolean;
  nodes: MapNode[];
  moved: { child: string; parent: string; why: string }[];
};

export type FoldedMap = {
  nodes: Map<string, MapNode>;
  /** Edges between real cards. */
  edges: Edge[];
  /** Edges of a ghost, held and drawn until the ghost goes real. */
  ghostEdges: Edge[];
  /** The parent of each card that has one, held or live. */
  parents: Map<string, string>;
  /** The notes of each id ever proposed. A discard keeps them (#werk-propose-new-discard-thread). */
  threads: Map<string, ThreadEntry[]>;
  /** The removals that are not undone, oldest first. Their nodes are not in `nodes`. */
  removals: Removal[];
  /** Edges with an end that is out. Each returns when both ends are in the map (#werk-write-remove-links). */
  waiting: Edge[];
  problems: Problem[];
};

/** One non-blank line of the log, parsed. A line that is not JSON carries its error. */
export type LogEntry = { line: number; event: unknown; error?: string };

export function emptyMap(): FoldedMap {
  return {
    nodes: new Map(),
    edges: [],
    ghostEdges: [],
    parents: new Map(),
    threads: new Map(),
    removals: [],
    waiting: [],
    problems: [],
  };
}

/** Splits the text of a log into entries. Blank lines are skipped, and keep their line numbers. */
export function parseLog(text: string): LogEntry[] {
  const entries: LogEntry[] = [];
  text.split("\n").forEach((raw, index) => {
    if (raw.trim() === "") return;
    try {
      entries.push({ line: index + 1, event: JSON.parse(raw) });
    } catch (error) {
      entries.push({
        line: index + 1,
        event: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return entries;
}

type Fields = Record<string, unknown>;

const bad = (detail: string): Violation => ({ rule: "bad-event", detail });

function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return (
    typeof value === "string" && (allowed as readonly string[]).includes(value)
  );
}

/** A string field that may be missing. A present field of another type is a violation. */
function optional(fields: Fields, key: string): string | null | Violation {
  const value = fields[key];
  if (value === undefined) return null;
  if (typeof value !== "string") return bad(`"${key}" must be text`);
  return value;
}

function isViolation(value: unknown): value is Violation {
  return isRecord(value) && "rule" in value;
}

function sameLink(a: Edge, b: Edge): boolean {
  return a.from === b.from && a.to === b.to && a.type === b.type;
}

function addEdge(map: FoldedMap, edge: Edge): void {
  const from = map.nodes.get(edge.from);
  const to = map.nodes.get(edge.to);
  if (edge.type === "refines") map.parents.set(edge.from, edge.to);
  const held = from?.proposed || to?.proposed;
  const list = held ? map.ghostEdges : map.edges;
  // Linking the same pair again replaces the reason (#vi-prop-linkwhy).
  const at = list.findIndex((other) => sameLink(other, edge));
  if (at === -1) list.push(edge);
  else list[at] = edge;
}

function applyProposed(
  map: FoldedMap,
  fields: Fields,
  line: number,
): Violation | null {
  const { id, kind, title, status } = fields;
  if (typeof id !== "string" || id === "") return bad('"id" must be text');
  if (typeof title !== "string") return bad('"title" must be text');
  if (!oneOf(kind, KINDS))
    return bad(`"kind" must be one of ${KINDS.join(", ")}`);
  if (!oneOf(status, STATUSES)) {
    return bad(`"status" must be one of ${STATUSES.join(", ")}`);
  }
  const why = optional(fields, "why");
  const body = optional(fields, "body");
  const parent = optional(fields, "parent");
  const who = optional(fields, "who");
  for (const value of [why, body, parent, who]) {
    if (isViolation(value)) return value;
  }
  if (who !== null && !oneOf(who, WHOS)) {
    return bad(`"who" must be one of ${WHOS.join(", ")}`);
  }
  if (map.nodes.has(id)) {
    return { rule: "duplicate-id", detail: `the id "${id}" is taken` };
  }
  if (isOut(map, id)) {
    return {
      rule: "duplicate-id",
      detail: `the id "${id}" is taken by a removed card; restore it to bring it back`,
    };
  }
  if (kind === "excerpt") return EXCERPT_ADD_REFUSAL;
  if (typeof parent === "string") {
    if (!map.nodes.has(parent)) {
      return { rule: "unknown-card", detail: `no card "${parent}"` };
    }
    if (kind === "option") {
      return {
        rule: "option-link",
        detail: `option "${id}" links by alternative_to only, not refines`,
      };
    }
  }
  map.nodes.set(id, {
    id,
    kind,
    title,
    why: typeof why === "string" ? why : "",
    body: typeof body === "string" ? body : "",
    status,
    who,
    proposed: true,
    marks: [],
    noBasis: null,
    unchallenged: null,
    kill: [],
    pending: null,
  });
  const thread = map.threads.get(id);
  if (thread) thread.push({ line, kind: "proposed-again" });
  else map.threads.set(id, []);
  // The parent is part of what was added: one event makes the card and its link (#pr-log-one-event).
  if (typeof parent === "string") {
    addEdge(map, { from: id, to: parent, type: "refines", why: "" });
  }
  return null;
}

function applyEdgeAdded(map: FoldedMap, fields: Fields): Violation | null {
  const { from, to, link } = fields;
  if (typeof from !== "string" || typeof to !== "string") {
    return bad('"from" and "to" must be text');
  }
  if (!oneOf(link, LINK_TYPES)) {
    return bad(`"link" must be one of ${LINK_TYPES.join(", ")}`);
  }
  const why = optional(fields, "why");
  if (isViolation(why)) return why;
  const edge: Edge = { from, to, type: link, why: why ?? "" };
  const violation = checkLink(map, edge);
  if (violation) return violation;
  addEdge(map, edge);
  return null;
}

/**
 * Checks one event against the map and applies it when it holds every rule.
 * Returns the rule it breaks otherwise, and leaves the map as it was.
 */
function applyAccepted(map: FoldedMap, fields: Fields): Violation | null {
  if (typeof fields.id !== "string") return bad('"id" must be text');
  const node = map.nodes.get(fields.id);
  return node && !node.proposed
    ? acceptChange(map, fields.id, fields.actor)
    : acceptGhost(map, fields.id, fields.actor);
}

function applyDiscarded(map: FoldedMap, fields: Fields): Violation | null {
  if (typeof fields.id !== "string") return bad('"id" must be text');
  const node = map.nodes.get(fields.id);
  return node && !node.proposed
    ? discardChange(map, fields.id)
    : discardGhost(map, fields.id);
}

/** The id and the reparent flag of a removal event. */
function removalFields(
  fields: Fields,
): { id: string; reparent: boolean } | Violation {
  if (typeof fields.id !== "string") return bad('"id" must be text');
  const { reparent } = fields;
  if (reparent !== undefined && typeof reparent !== "boolean") {
    return bad('"reparent" must be true or false');
  }
  return { id: fields.id, reparent: reparent === true };
}

function applyNote(
  map: FoldedMap,
  fields: Fields,
  line: number,
): Violation | null {
  const { id, by, text } = fields;
  if (typeof id !== "string") return bad('"id" must be text');
  if (typeof by !== "string") return bad('"by" must be text');
  if (typeof text !== "string" || text === "")
    return bad('"text" must be text');
  const thread = map.threads.get(id);
  if (!thread || !map.nodes.has(id)) {
    return { rule: "unknown-card", detail: `no card "${id}"` };
  }
  thread.push({ line, kind: "note", by, text });
  return null;
}

/** A waiver reason from an edit: null when absent, a violation when empty. */
function waiver(fields: Fields, key: string): string | null | Violation {
  const reason = optional(fields, key);
  if (reason === null || isViolation(reason)) return reason;
  if (reason.trim() === "") {
    return {
      rule: "waiver",
      detail: `a waiver needs a reason: say why in "${key}"`,
    };
  }
  return reason;
}

function applyEdited(map: FoldedMap, fields: Fields): Violation | null {
  const { id } = fields;
  if (typeof id !== "string") return bad('"id" must be text');
  const why = optional(fields, "why");
  const body = optional(fields, "body");
  const who = optional(fields, "who");
  const noBasis = waiver(fields, "noBasis");
  const unchallenged = waiver(fields, "unchallenged");
  if (isViolation(why)) return why;
  if (isViolation(body)) return body;
  if (isViolation(who)) return who;
  if (isViolation(noBasis)) return noBasis;
  if (isViolation(unchallenged)) return unchallenged;
  if (who !== null && !oneOf(who, WHOS)) {
    return bad(`"who" must be one of ${WHOS.join(", ")}`);
  }
  const node = map.nodes.get(id);
  if (!node) return { rule: "unknown-card", detail: `no card "${id}"` };
  if (node.kind === "excerpt" && (why !== null || body !== null)) {
    return { rule: "excerpt", detail: excerptFrozenDetail(id) };
  }
  if (why !== null || body !== null) {
    return {
      rule: "frozen",
      detail: node.proposed
        ? `"${id}" is a ghost and its words are frozen; discard it and propose it again`
        : `"${id}" changes its words only through a proposal`,
    };
  }
  const set = (target: FoldedMap): null => {
    const card = target.nodes.get(id) as MapNode;
    if (who !== null) card.who = who;
    if (noBasis !== null) card.noBasis = noBasis;
    if (unchallenged !== null) card.unchallenged = unchallenged;
    return null;
  };
  // A decided card takes a change of who or a waiver only when it keeps every fact it had.
  if (node.status === "decided") {
    return applyKept(map, ["who", "basis", "option", "kill"], set);
  }
  return set(map);
}

function applyCriterion(map: FoldedMap, fields: Fields): Violation | null {
  const { id, form } = fields;
  if (typeof id !== "string") return bad('"id" must be text');
  if (!oneOf(form, Object.keys(CRITERION_FIELDS) as Criterion["form"][])) {
    return bad(
      `"form" must be one of ${Object.keys(CRITERION_FIELDS).join(", ")}`,
    );
  }
  const criterion: Record<string, string> = { form };
  for (const key of CRITERION_FIELDS[form]) {
    const value = fields[key];
    if (typeof value !== "string" || value.trim() === "") {
      return bad(`a "${form}" criterion needs "${key}" as text`);
    }
    criterion[key] = value;
  }
  const node = map.nodes.get(id);
  if (!node) {
    return (
      outRefusal(map, id) ?? { rule: "unknown-card", detail: `no card "${id}"` }
    );
  }
  node.kill.push(criterion as Criterion);
  return null;
}

function applyDecided(map: FoldedMap, fields: Fields): Violation | null {
  const { id } = fields;
  if (typeof id !== "string") return bad('"id" must be text');
  const node = map.nodes.get(id);
  if (!node) return outRefusal(map, id) ?? checkDecide(map, id);
  if (node.status === "decided") {
    return { rule: "contract", detail: `"${id}" is already decided` };
  }
  const violation = checkDecide(map, id);
  if (violation) return violation;
  (map.nodes.get(id) as MapNode).status = "decided";
  clearResumed(map, id);
  return null;
}

export function applyEvent(
  map: FoldedMap,
  event: unknown,
  line = 0,
): Violation | null {
  if (!isRecord(event)) return bad("an event is a JSON object");
  switch (event.type) {
    case "node.proposed":
      return applyProposed(map, event, line);
    case "excerpt.quoted":
      return applyQuoted(map, event, addEdge);
    case "node.accepted":
      return applyAccepted(map, event);
    case "node.discarded":
      return applyDiscarded(map, event);
    case "change.proposed":
      return proposeChange(map, event);
    case "node.edited":
      return applyEdited(map, event);
    case "criterion.added":
      return applyCriterion(map, event);
    case "node.decided":
      return applyDecided(map, event);
    case "node.removed": {
      const removal = removalFields(event);
      return isViolation(removal)
        ? removal
        : applyKept(map, ["option"], (trial) =>
            removeCard(trial, removal.id, removal.reparent),
          );
    }
    case "node.restored":
      return typeof event.id === "string"
        ? restoreCard(map, event.id)
        : bad('"id" must be text');
    case "node.reopened":
      return applyReopen(map, event);
    case "node.reviewed":
      return applyReview(map, event);
    case "note.added":
      return applyNote(map, event, line);
    case "edge.added":
      return applyEdgeAdded(map, event);
    default:
      return bad(`unknown event type ${JSON.stringify(event.type)}`);
  }
}

/** Folds every entry of the log, from the first to the last. */
export function fold(entries: readonly LogEntry[]): FoldedMap {
  const map = emptyMap();
  for (const entry of entries) {
    const violation: Violation | null =
      entry.error !== undefined
        ? { rule: "bad-json", detail: entry.error }
        : applyEvent(map, entry.event, entry.line);
    if (violation) map.problems.push({ line: entry.line, ...violation });
  }
  return map;
}
