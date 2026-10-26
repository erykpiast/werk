// The shapes of the decision log and of the map folded from it (#pr-log, #map-card, #vi-edges).
import type { Op } from "./ops.ts";

export type NodeKind = "card" | "option" | "source" | "excerpt";
export type Status = "open" | "proto" | "decided";
export type Who = "you" | "me" | "prototype";
export type LinkType = "refines" | "depends_on" | "supported_by" | "alternative_to";

export const NODE_KINDS: readonly NodeKind[] = ["card", "option", "source", "excerpt"];
export const STATUSES: readonly Status[] = ["open", "proto", "decided"];
export const WHOS: readonly Who[] = ["you", "me", "prototype"];
export const LINK_TYPES: readonly LinkType[] = ["refines", "depends_on", "supported_by", "alternative_to"];

/** The words and fields of a node, as an add or a proposal writes them. */
export type NodeFields = {
  id: string;
  kind: NodeKind;
  title: string;
  why?: string;
  body?: string;
  status?: Status;
  who?: Who;
  /** option: why it lost. */
  why_not?: string;
  /** source: where it is, and what it found. */
  url?: string;
  finding?: string;
} & Partial<ExcerptPointer>;

/**
 * Where an excerpt's words were said (#werk-excerpt-pointer). `message` counts every line of the
 * conversation's chat log from zero; `start` and `end` cut the quote out of that message's text.
 */
export type ExcerptPointer = {
  conversation: string;
  session: string;
  message: number;
  start: number;
  end: number;
  speaker: string;
  said_at: string;
};

/** A quoted excerpt: its id, its words as the title, and its pointer. */
export type ExcerptFields = { id: string; title: string } & ExcerptPointer;

/** One kill criterion: what must become true to revisit the decision (#kill, #kill-shape). */
export type KillCriterion =
  | { form: "metric"; metric: string; source: string; threshold: string; window: string }
  | { form: "manual"; test: string }
  | { form: "no-metric"; reason: string }
  | { form: "revisit" };

export type KillForm = KillCriterion["form"];
export const KILL_FORMS: readonly KillForm[] = ["metric", "manual", "no-metric", "revisit"];

/** The records a card carries beside its words: who decides, and the waivers with their reasons (#werk-cli-edit). */
export type CardRecords = {
  who?: Who;
  /** Why no decided card is a basis (#werk-contract-waiver-reason). */
  no_basis?: string;
  /** Why no option was weighed against the card (#werk-contract-guess). */
  unchallenged?: string;
};

/** A staged change to the words of a real node: a new title, a new why, the ops on its body (#al-diff-cli). */
export type Proposal = { title?: string; why?: string; ops?: Op[] };

/** One line of the log. `seq` counts the events; `at` is when it was written. */
export type Event =
  /** A real node, and its refines link to `parent` in the same event (#pr-log-one-event). */
  | { seq: number; at: string; actor: Actor; type: "node.added"; payload: NodeFields & { parent?: string } }
  /** A ghost: in the map, waiting for the person's accept (#werk-propose-new). */
  | { seq: number; at: string; actor: Actor; type: "node.proposed"; payload: NodeFields & { parent?: string } }
  /**
   * A ghost excerpt and its held supported_by link from the citing `card`, as one change. Only a
   * quote writes it (#werk-excerpt-event).
   */
  | { seq: number; at: string; actor: Actor; type: "excerpt.quoted"; payload: ExcerptFields & { card: string } }
  | { seq: number; at: string; actor: Actor; type: "node.retitled"; payload: { id: string; title: string } }
  | {
      seq: number;
      at: string;
      actor: Actor;
      type: "node.bodyEdited";
      payload: { id: string; why?: string; body?: string };
    }
  /** A card moves to decided, after the contract check (#werk-cli-decide). */
  | { seq: number; at: string; actor: Actor; type: "node.decided"; payload: { id: string } }
  /** Sets who decides, or records a waiver, on a card (#werk-cli-edit). */
  | { seq: number; at: string; actor: Actor; type: "node.edited"; payload: CardRecords & { id: string } }
  /** Adds one kill criterion to a card (#kill-ask). */
  | { seq: number; at: string; actor: Actor; type: "kill.added"; payload: { id: string; criterion: KillCriterion } }
  | { seq: number; at: string; actor: Actor; type: "edge.added"; payload: Link }
  | { seq: number; at: string; actor: Actor; type: "edge.removed"; payload: Omit<Link, "why"> }
  /** Stages a change to a real node's words. It replaces the node's pending change (#al-diff-cli). */
  | { seq: number; at: string; actor: Actor; type: "change.proposed"; payload: Proposal & { id: string } }
  /**
   * A ghost becomes real, or a real node takes its pending change. On a decided card that is an
   * amend: a reopen and a decide in one step (#map-frozen).
   */
  | { seq: number; at: string; actor: Actor; type: "change.accepted"; payload: { id: string } }
  /** A ghost leaves the map, with every link it holds, or a real node drops its pending change. */
  | { seq: number; at: string; actor: Actor; type: "change.discarded"; payload: { id: string } }
  /**
   * A card leaves the map with its refines subtree, its options and excerpts, and the sources that
   * only they cite. With `reparent`, its direct children move up to its parent instead (#werk-remove).
   */
  | { seq: number; at: string; actor: Actor; type: "node.removed"; payload: { id: string; reparent?: boolean } }
  /** The exact inverse of the removal that named `id` (#werk-remove-restore-undo). */
  | { seq: number; at: string; actor: Actor; type: "node.restored"; payload: { id: string } }
  /** One note on the thread of a node id (#werk-cli-notes). */
  | { seq: number; at: string; actor: Actor; type: "note.added"; payload: { id: string; text: string } };

export type EventType = Event["type"];
export type Actor = "you" | "agent";

/** An event before the write stamps its place and time on it. */
export type Draft = {
  [T in EventType]: { type: T; actor: Actor; payload: Extract<Event, { type: T }>["payload"] };
}[EventType];

/** `why` is what `from` takes from `to`; a depends_on link needs it (#vi-prop-linkwhy). */
export type Link = { from: string; to: string; type: LinkType; why?: string };

export type MapNode = NodeFields &
  Pick<CardRecords, "no_basis" | "unchallenged"> & {
    status: Status;
    proposed: boolean;
    kill?: KillCriterion[];
    /** The change staged on a real node, until an accept, an amend or a discard. */
    pending?: Proposal;
  };

/**
 * One entry of a thread: a note, or the marker where its id was proposed again after a discard.
 * A note above a marker was about the earlier words (#werk-propose-new-discard-thread).
 */
export type ThreadEntry =
  | { kind: "note"; seq: number; at: string; actor: Actor; text: string }
  | { kind: "proposed again"; seq: number; at: string };

/** A log line the fold set aside: its 1-based line number and the rule it breaks (#pr-log-refuse). */
export type Problem = { line: number; rule: string };

/**
 * One removal, under the id of the card it named. `taken` is every node it took out, the named card
 * first. `moved` holds the direct children that a reparent moved up to `to`, the card's parent.
 */
export type Removal = { taken: string[]; moved?: { children: string[]; to: string } };

/**
 * The fold of the log. `links` holds the live links: both ends are real. `ghostEdges` holds the
 * links with a ghost end; the fold moves each one into `links` once both ends are real, so a
 * derivation that reads `links` never sees a ghost (#werk-propose-new).
 */
export type FoldedMap = {
  nodes: Map<string, MapNode>;
  links: Link[];
  ghostEdges: Link[];
  /**
   * The nodes out of the map, and the removals that took them. A node out is in no other field, and
   * each link with an end out waits in `waiting` until both ends are in again (#werk-write-remove-links).
   */
  removed: Map<string, MapNode>;
  removals: Map<string, Removal>;
  waiting: Link[];
  problems: Problem[];
  /** The thread of each node id. It belongs to the id, so a discard leaves it in place. */
  threads: Map<string, ThreadEntry[]>;
  /** The `seq` of the last event folded, 0 for an empty log. */
  lastSeq: number;
};
