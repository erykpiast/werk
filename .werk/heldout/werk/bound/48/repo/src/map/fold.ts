// The map is the fold of the log (#pr-log): each event changes the state the events above it
// built, so the map holds the latest words and links of each node (#vi-overwrite). Each line
// passes the map rules first; a line that breaks one is set aside as a problem with its line
// number, and the lines after it still fold (#pr-log-refuse).
import { applyOps } from "./ops.ts";
import { removalOf } from "./removal.ts";
import { check } from "./rules.ts";
import { isLive, sameLink } from "./tree.ts";
import type { Event, FoldedMap, Link, MapNode, Removal } from "./types.ts";

export function emptyMap(): FoldedMap {
  return {
    nodes: new Map(),
    links: [],
    ghostEdges: [],
    removed: new Map(),
    removals: new Map(),
    waiting: [],
    problems: [],
    threads: new Map(),
    lastSeq: 0,
  };
}

/** A copy that a trial write can change without touching the original. */
export function copyMap(map: FoldedMap): FoldedMap {
  // A kill criterion is added by replacing the list, so a shallow copy of each node is enough.
  const nodes = new Map([...map.nodes].map(([id, node]) => [id, { ...node }]));
  const removed = new Map([...map.removed].map(([id, node]) => [id, { ...node }]));
  const removals = new Map(
    [...map.removals].map(([id, removal]) => [
      id,
      {
        taken: [...removal.taken],
        ...(removal.moved && { moved: { children: [...removal.moved.children], to: removal.moved.to } }),
      },
    ]),
  );
  return {
    nodes,
    links: map.links.map((link) => ({ ...link })),
    ghostEdges: map.ghostEdges.map((link) => ({ ...link })),
    removed,
    removals,
    waiting: map.waiting.map((link) => ({ ...link })),
    problems: [...map.problems],
    threads: new Map([...map.threads].map(([id, entries]) => [id, [...entries]])),
    lastSeq: map.lastSeq,
  };
}

/**
 * Puts a link with the live links when both ends are real, holds it while an end is a ghost, and
 * lets it wait while an end is out of the map (#werk-write-remove-links).
 */
function place(map: FoldedMap, link: Link): void {
  if (!map.nodes.has(link.from) || !map.nodes.has(link.to)) map.waiting.push(link);
  else (isLive(map, link) ? map.links : map.ghostEdges).push(link);
}

/** Places every link again, in its order, after nodes went real, out or back in. */
function replace(map: FoldedMap): void {
  const every = [...map.links, ...map.ghostEdges, ...map.waiting];
  map.links = [];
  map.ghostEdges = [];
  map.waiting = [];
  for (const link of every) place(map, link);
}

function drop(map: FoldedMap, keep: (link: Link) => boolean): void {
  map.links = map.links.filter(keep);
  map.ghostEdges = map.ghostEdges.filter(keep);
  map.waiting = map.waiting.filter(keep);
}

/** Points the refines link of each child from `from` to `to`, wherever the link sits now. */
function moveChildren(map: FoldedMap, children: string[], from: string, to: string): void {
  for (const list of [map.links, map.ghostEdges, map.waiting]) {
    for (const link of list) {
      if (link.type === "refines" && link.to === from && children.includes(link.from)) link.to = to;
    }
  }
}

function moveNode(from: Map<string, MapNode>, to: Map<string, MapNode>, id: string): void {
  const node = from.get(id);
  if (node) to.set(id, node);
  from.delete(id);
}

/** Puts a new node in the map. An id with a thread and no node was discarded, so this is a new
 * proposal of it (#werk-propose-new-discard-thread). */
function addNode(map: FoldedMap, event: Event, node: MapNode): void {
  map.threads.get(node.id)?.push({ kind: "proposed again", seq: event.seq, at: event.at });
  map.nodes.set(node.id, node);
}

/** Puts a node's pending change into its words. Its status stays, so an amend never shows it open (#map-frozen). */
function takePending(node: MapNode): void {
  const { pending } = node;
  if (pending === undefined) return;
  delete node.pending;
  if (pending.title !== undefined) node.title = pending.title;
  if (pending.why !== undefined) node.why = pending.why;
  if (pending.ops === undefined) return;
  const body = applyOps(node.body, pending.ops);
  if (body === "") delete node.body;
  else node.body = body;
}

/** Applies an event that passed the rules. */
function apply(map: FoldedMap, event: Event): void {
  switch (event.type) {
    case "node.added":
    case "node.proposed": {
      const { parent, ...fields } = event.payload;
      addNode(map, event, { ...fields, status: fields.status ?? "open", proposed: event.type === "node.proposed" });
      // The place of a new card is part of the same event (#pr-log-one-event).
      if (parent !== undefined) place(map, { from: fields.id, to: parent, type: "refines" });
      return;
    }
    case "excerpt.quoted": {
      // The excerpt and the link from its citing card are one change; the link is held until both
      // ends are real (#werk-excerpt-event).
      const { card, ...fields } = event.payload;
      addNode(map, event, { ...fields, kind: "excerpt", status: "open", proposed: true });
      place(map, { from: card, to: fields.id, type: "supported_by" });
      return;
    }
    case "node.retitled": {
      const node = map.nodes.get(event.payload.id);
      if (node) node.title = event.payload.title;
      return;
    }
    case "node.bodyEdited": {
      const node = map.nodes.get(event.payload.id);
      if (node && event.payload.why !== undefined) node.why = event.payload.why;
      if (node && event.payload.body !== undefined) node.body = event.payload.body;
      return;
    }
    case "node.decided": {
      const node = map.nodes.get(event.payload.id);
      if (node) node.status = "decided";
      return;
    }
    case "node.edited": {
      const node = map.nodes.get(event.payload.id);
      const { id: _id, ...records } = event.payload;
      if (node) Object.assign(node, records);
      return;
    }
    case "kill.added": {
      const node = map.nodes.get(event.payload.id);
      if (node) node.kill = [...(node.kill ?? []), event.payload.criterion];
      return;
    }
    case "edge.added": {
      // Linking the same pair again replaces its reason (#vi-prop-linkwhy).
      const { from, to, type, why } = event.payload;
      drop(map, (link) => !sameLink(link, event.payload));
      place(map, why === undefined ? { from, to, type } : { from, to, type, why });
      return;
    }
    case "edge.removed":
      drop(map, (link) => !sameLink(link, event.payload));
      return;
    case "change.proposed": {
      // A later proposal replaces the pending one (#al-diff-cli).
      const { id, ...pending } = event.payload;
      const node = map.nodes.get(id);
      if (node) node.pending = pending;
      return;
    }
    case "change.accepted": {
      // A held link goes live by itself once both its ends are real, with no event of its own.
      const node = map.nodes.get(event.payload.id);
      if (node && !node.proposed) {
        takePending(node);
        return;
      }
      if (node) node.proposed = false;
      replace(map);
      return;
    }
    case "change.discarded": {
      // A ghost's links are part of it, so they leave with it, and its id is free again. A real
      // node only drops its pending change.
      const { id } = event.payload;
      const node = map.nodes.get(id);
      if (node && !node.proposed) {
        delete node.pending;
        return;
      }
      map.nodes.delete(id);
      if (!map.threads.has(id)) map.threads.set(id, []);
      drop(map, (link) => link.from !== id && link.to !== id);
      return;
    }
    case "node.removed": {
      // Nothing leaves the log: the nodes move out of the map and their links wait (#werk-remove).
      const { id, reparent = false } = event.payload;
      const removal = removalOf(map, id, reparent);
      if (removal.moved) moveChildren(map, removal.moved.children, id, removal.moved.to);
      for (const each of removal.taken) moveNode(map.nodes, map.removed, each);
      map.removals.set(id, removal);
      replace(map);
      return;
    }
    case "node.restored": {
      // The exact inverse of the removal: the same nodes back, the moved children back under the
      // card (#werk-remove-restore-undo).
      const { id } = event.payload;
      const removal = map.removals.get(id) as Removal;
      for (const each of removal.taken) moveNode(map.removed, map.nodes, each);
      if (removal.moved) moveChildren(map, removal.moved.children, removal.moved.to, id);
      map.removals.delete(id);
      replace(map);
      return;
    }
    case "note.added": {
      const { id, text } = event.payload;
      const entry = { kind: "note" as const, seq: event.seq, at: event.at, actor: event.actor, text };
      map.threads.set(id, [...(map.threads.get(id) ?? []), entry]);
      return;
    }
  }
}

/** Checks one event against the map and applies it. Returns the rule it breaks, if any. */
export function step(map: FoldedMap, event: Event): string | undefined {
  const broken = check(map, event);
  if (broken === undefined) apply(map, event);
  if (typeof event.seq === "number" && event.seq > map.lastSeq) map.lastSeq = event.seq;
  return broken;
}

function parseLine(line: string): Event | string {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return "a log line is one JSON event";
  }
  if (typeof value !== "object" || value === null || typeof (value as { type?: unknown }).type !== "string")
    return "an event is an object with a type";
  return value as Event;
}

/** Folds the text of a log. Line numbers count from 1, empty lines included. */
export function fold(text: string): FoldedMap {
  const map = emptyMap();
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const event = parseLine(line);
    const broken = typeof event === "string" ? event : step(map, event);
    if (broken !== undefined) map.problems.push({ line: index + 1, rule: broken });
  });
  return map;
}
