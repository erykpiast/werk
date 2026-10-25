/**
 * The changes to a card that can change what a ticket must build, read from the decision log (#st-ticket-watch).
 * A change counts when it moves the title, why, body, status, existence, a stale mark or a depends_on edge of the
 * card. A note, a view change and the acceptance of a ghost move none of them. Pure: the same log gives the same list.
 */
import {
  applyEvent,
  emptyMap,
  type FoldedMap,
  type LogEntry,
} from "../map/fold.ts";

/** One counted change: the card, the kind of change in plain words, and the log line that made it. */
export type CitedChange = { card: string; kind: string; line: number };

type State = {
  presence: "real" | "ghost" | "absent";
  title: string;
  why: string;
  body: string;
  status: string;
  marks: string[];
};

function stateOf(map: FoldedMap, id: string): State {
  const node = map.nodes.get(id);
  if (!node) {
    return {
      presence: "absent",
      title: "",
      why: "",
      body: "",
      status: "",
      marks: [],
    };
  }
  return {
    presence: node.proposed ? "ghost" : "real",
    title: node.title,
    why: node.why,
    body: node.body,
    status: node.status,
    marks: node.marks.map((m) => `${m.kind}|${m.origin}|${m.at}`),
  };
}

/** The depends_on edges that touch each watched card, as "from>to" texts. */
function dependsOf(map: FoldedMap, watched: ReadonlySet<string>) {
  const edges = new Map<string, Set<string>>();
  for (const id of watched) edges.set(id, new Set());
  for (const edge of map.edges) {
    if (edge.type !== "depends_on") continue;
    const text = `${edge.from}>${edge.to}`;
    edges.get(edge.from)?.add(text);
    edges.get(edge.to)?.add(text);
  }
  return edges;
}

const MARK_KIND: Record<string, string> = {
  stale: "marked stale",
  paused: "marked paused",
  postponed: "marked postponed",
};

function statusKind(before: string, after: string): string {
  if (before === "decided") return "reopened";
  return after === "decided" ? "decided" : "status changed";
}

function kindsOf(
  before: State,
  after: State,
  edgesBefore: ReadonlySet<string>,
  edgesAfter: ReadonlySet<string>,
): string[] {
  const kinds: string[] = [];
  if (before.presence === "real" && after.presence === "absent") {
    kinds.push("removed");
  } else if (before.presence === "absent" && after.presence === "real") {
    kinds.push("restored");
  } else if (before.presence === "real" && after.presence === "real") {
    if (before.title !== after.title) kinds.push("title changed");
    if (before.why !== after.why) kinds.push("why changed");
    if (before.body !== after.body) kinds.push("body changed");
    if (before.status !== after.status) {
      kinds.push(statusKind(before.status, after.status));
    }
  }
  if (after.presence === "real") {
    const known = new Set(before.marks);
    for (const mark of after.marks) {
      if (known.has(mark)) continue;
      kinds.push(MARK_KIND[mark.split("|")[0] as string] ?? "marked");
    }
  }
  if ([...edgesAfter].some((edge) => !edgesBefore.has(edge))) {
    kinds.push("depends_on edge added");
  }
  if ([...edgesBefore].some((edge) => !edgesAfter.has(edge))) {
    kinds.push("depends_on edge removed");
  }
  return kinds;
}

/** Every counted change to the watched cards, in log order. */
export function citedChanges(
  entries: readonly LogEntry[],
  watched: ReadonlySet<string>,
): CitedChange[] {
  if (watched.size === 0) return [];
  const map = emptyMap();
  const changes: CitedChange[] = [];
  let states = new Map<string, State>();
  let edges = dependsOf(map, watched);
  let edgeCount = 0;
  for (const id of watched) states.set(id, stateOf(map, id));
  for (const entry of entries) {
    if (entry.error !== undefined) continue;
    if (applyEvent(map, entry.event, entry.line) !== null) continue;
    const edgesNow =
      map.edges.length === edgeCount ? edges : dependsOf(map, watched);
    const next = new Map<string, State>();
    for (const id of watched) {
      const before = states.get(id) as State;
      const after = stateOf(map, id);
      next.set(id, after);
      const kinds = kindsOf(
        before,
        after,
        edges.get(id) as ReadonlySet<string>,
        edgesNow.get(id) as ReadonlySet<string>,
      );
      for (const kind of kinds) {
        changes.push({ card: id, kind, line: entry.line });
      }
    }
    states = next;
    edges = edgesNow;
    edgeCount = map.edges.length;
  }
  return changes;
}

/** The line of the latest counted change of each card, or 0 for a card with none: the version a ticket records. */
export function versionsOf(
  changes: readonly CitedChange[],
  cards: readonly string[],
): Record<string, number> {
  const versions: Record<string, number> = {};
  for (const card of cards) versions[card] = 0;
  for (const change of changes) {
    if (change.card in versions) {
      versions[change.card] = Math.max(
        versions[change.card] as number,
        change.line,
      );
    }
  }
  return versions;
}
