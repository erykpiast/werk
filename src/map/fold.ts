/**
 * The fold: a pure function from the events of the log to the map. See #pr-log.
 * An event that breaks a map rule is not applied. The fold lists it as a problem
 * and the events after it still fold (#pr-log-refuse). A write checks its events
 * with the same step function, so the fold and a write never disagree.
 */

import { acceptGhost, discardGhost } from "./ghost-rules.ts";
import { checkLink } from "./link-rules.ts";
import { isOut, removeCard, restoreCard } from "./removal-rules.ts";

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

/** A stale, paused or postponed mark. Later tickets derive them (#pr-log-fold-marks). */
export type Mark = { kind: "stale" | "paused" | "postponed"; trace: string };

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
  | "ghost-parent"
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
  return acceptGhost(map, fields.id, fields.actor);
}

function applyDiscarded(map: FoldedMap, fields: Fields): Violation | null {
  if (typeof fields.id !== "string") return bad('"id" must be text');
  return discardGhost(map, fields.id);
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

function applyEdited(map: FoldedMap, fields: Fields): Violation | null {
  const { id } = fields;
  if (typeof id !== "string") return bad('"id" must be text');
  const why = optional(fields, "why");
  const body = optional(fields, "body");
  const who = optional(fields, "who");
  if (isViolation(why)) return why;
  if (isViolation(body)) return body;
  if (isViolation(who)) return who;
  if (who !== null && !oneOf(who, WHOS)) {
    return bad(`"who" must be one of ${WHOS.join(", ")}`);
  }
  const node = map.nodes.get(id);
  if (!node) return { rule: "unknown-card", detail: `no card "${id}"` };
  if (why !== null || body !== null) {
    return {
      rule: "frozen",
      detail: node.proposed
        ? `"${id}" is a ghost and its words are frozen; discard it and propose it again`
        : `"${id}" changes its words only through a proposal`,
    };
  }
  if (who !== null) node.who = who;
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
    case "node.accepted":
      return applyAccepted(map, event);
    case "node.discarded":
      return applyDiscarded(map, event);
    case "node.edited":
      return applyEdited(map, event);
    case "node.removed": {
      const removal = removalFields(event);
      return isViolation(removal)
        ? removal
        : removeCard(map, removal.id, removal.reparent);
    }
    case "node.restored":
      return typeof event.id === "string"
        ? restoreCard(map, event.id)
        : bad('"id" must be text');
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
