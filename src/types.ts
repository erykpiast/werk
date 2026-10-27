// The schema from decision-map-structure.md, cut to what the MVP uses.

export type NodeKind = 'card' | 'source' | 'excerpt' | 'option'
export type Status = 'decided' | 'open' | 'proto'
export type Who = 'you' | 'me' | 'prototype'
/**
 * Why a card was reopened. Only `invalidated` means the content is wrong now.
 * `postponed` means it still holds, just not being worked on. `rejected` means
 * the card lost to an alternative. Missing on old log events — read as `invalidated`,
 * so history keeps its old meaning.
 */
export type ReopenReason = 'postponed' | 'invalidated' | 'rejected' | 'amended'

/** The latest reopen recorded directly on one id, while the id is not decided again. Not the
 *  fanned-out closure — the cause. */
export type Reopen = { reason: ReopenReason; why?: string; at: string }

/** A change to a card's body, proposed as blocks instead of a flat replacement.
 *  See #al-diff-cli and web/diff.js, which computes and renders these. */
export type BodyOp =
  | { tag: 'elaborated'; old: string; new: string }
  | { tag: 'new'; new: string }
  | { tag: 'removed'; old: string }

/** A change awaiting `werk accept`/`werk discard`. Cleared by either. */
export type Pending = {
  title?: string
  why?: string
  ops?: BodyOp[]
  rejected?: { op: BodyOp; reason: string }[]
  /** A proposed removal, not an edit. The ✓ runs the removal — #werk-remove. */
  remove?: boolean
  reparent?: boolean
  /** Who decides and the waivers a proposal sets. On a decided card the ✓ is an amend — #werk-contract-amend-who. */
  facts?: Partial<Pick<GraphNode, 'who' | 'noBasis' | 'noAlternative'>>
}

/** What a kill criterion is made of — #kill-shape. */
export type KillForm = 'metric' | 'manual' | 'no-metric' | 'revisit'
/** What checks it — #kill-trigger. `none`: not tracked, revisited whenever someone chooses. */
export type KillTrigger = 'metric' | 'event' | 'date' | 'none'
export type KillReason = 'unclear' | 'cheap' | 'slow' | 'values' | 'constraint'
export type KillState = 'monitored' | 'unmonitored' | 'fired'

/** One condition, set by the author at decision time, under which the decision is revisited. */
export type KillCriterion = {
  form: KillForm
  trigger: KillTrigger
  state: KillState
  /** manual: the test. no-metric: the reason in words. */
  text?: string
  source?: string
  metric?: string
  threshold?: string
  window?: string
  minSample?: number
  reviewDate?: string
  reason?: KillReason
  /** The rejected :optN node to fall back to when this fires. */
  fallback?: string
  /** Why the state is what it is: when it fired and on what value, or why a check failed. */
  detail?: string
}

export type EdgeType =
  | 'refines' // card -> card. The level tree.
  | 'depends_on' // card -> card. Propagates staleness.
  | 'supported_by' // card -> source | excerpt. Records evidence, carries no flag — #vi-srcnode-doubt.
  | 'alternative_to' // option -> card. Kept forever.

export type GraphNode = {
  id: string
  kind: NodeKind
  title: string
  /** One line. Why this node exists. */
  why?: string
  body?: string
  status?: Status
  who?: Who
  /** decided with no depends_on edge, on record as intentional (a root card, a source). */
  noBasis?: boolean
  /** decided, who: you, with no alternative_to option, on record as intentional. */
  noAlternative?: boolean
  /** Kill criteria, in the order recorded. Missing means none are on record — #kill. */
  kill?: KillCriterion[]
  /** A proposed change not yet accepted or discarded. Derived, never stored directly —
   *  see the change.proposed/accepted/discarded cases in fold.ts. */
  pending?: Pending
  /** The card obligation this card answers, if any. See #st-build-card. */
  obligation?: string
  /** The node itself is proposed and not accepted yet — a ghost. It is in the log and in
   *  `nodes`, but out of every derivation: no edge of its own is live, it counts in no
   *  rollup, and it flags nothing. See #werk-propose-new. */
  proposed?: boolean
  // source
  url?: string
  finding?: string
  // option
  why_not?: string
  // excerpt — the pointer of #werk-excerpt-pointer
  /** The conversation whose chat log holds the quoted message. */
  conversation?: string
  session?: string
  msgIndex?: number | null
  /** When the quoted message was written. */
  saidAt?: string | null
  span?: [number, number] | null
  text?: string
  speaker?: 'you' | 'agent'
  context?: string
}

/**
 * `why` is what `from` takes from `to`, one sentence — #vi-prop-linkwhy. Required on a new
 * depends_on link, absent on the links recorded before that rule, never used on other types.
 */
export type Edge = { from: string; to: string; type: EdgeType; why?: string }

export type EventType =
  | 'node.added'
  /** A node staged for acceptance. Same payload as node.added — see #werk-propose-new. */
  | 'node.proposed'
  /** Out of the map, still in the log. Reversible with node.restored. See #werk-remove. */
  | 'node.removed'
  | 'node.restored'
  | 'node.retitled'
  | 'node.bodyEdited'
  | 'edge.added'
  | 'edge.removed'
  | 'status.set'
  | 'reopened'
  | 'rederived'
  | 'option.chosen'
  | 'change.proposed'
  | 'change.accepted'
  | 'change.discarded'
  | 'level.moved'
  /** One kill criterion recorded on a card. See #kill. */
  | 'kill.added'
  | 'kill.cleared'
  /** A criterion's state changed: monitored, unmonitored, fired. */
  | 'kill.state'
  | 'note.added' // a message typed at one node. The per-node conversation.
  /** A build started and owes the map at least one card. See #st-build-card. */
  | 'obligation.created'
  /** A pass closed its obligation with "no new decision" and named the cards it followed. */
  | 'obligation.followed'

export type Event = {
  seq: number
  at: string
  actor: 'you' | 'agent'
  type: EventType
  payload: any
}

export type Note = { seq: number; at: string; node: string; from: 'you' | 'agent'; text: string }

/** One line per card, counted over its refines subtree. The card itself is included. */
export type Rollup = {
  cards: number
  open: number
  proto: number
  decided: number
  /** Decided and who: you. The population the unchallenged ratio is out of. */
  yours: number
  /** who: you, decided, and no option was ever put against it. See #al-two. */
  unchallenged: number
  stale: number
  /** Postponed, not invalidated. See #reopen-reason-gap. */
  postponed: number
  /** Of `open`/`proto`/`decided` above, how many are also postponed. The bar textures this
   *  slice instead of giving postponed its own segment, so widths still sum to `cards`. */
  openPostponed: number
  protoPostponed: number
  decidedPostponed: number
}

/**
 * Why one card carries a stale or postponed mark — #vi-prop-bornstale.
 *
 * The mark alone says "something upstream was reopened" and stops there. The card carrying
 * it can sit four depends_on hops from the reopen, on a path that appears nowhere in its own
 * text. This is that path, written down at fold time instead of re-traced by hand.
 */
export type FlagTrace = {
  kind: 'stale' | 'postponed'
  /** The card that was actually reopened. Never flagged itself — a reopen marks dependents. */
  origin: string
  reason: ReopenReason
  /** When the reopen happened, ISO. */
  at: string
  why?: string
  /** depends_on hops from this card to `origin`, `origin` last. `[origin]` when it is direct. */
  via: string[]
  /**
   * The reason on each hop of `via`, same order: `whys[0]` is this card's link to `via[0]`.
   * Null where the link has no reason on record. #vi-prop-linkwhy: without it a reader sees
   * that a path exists but not whether the reopen can matter here.
   */
  whys: (string | null)[]
}

/** A card taken out of the map, kept for `werk removed` and for restoring. #werk-remove. */
export type Removed = { id: string; title: string; kind: NodeKind; at: string; parent?: string }

/**
 * The demand a build puts in the log before any code is written (#st-build-card). The CLI
 * creates it; the agent satisfies it with one or more cards that name it, or with a "no new
 * decision" record that names the cards it followed. Unsatisfied while `cards` is empty and
 * there is no record. The open ticket shows what its builds gave (#vi-board-ticket-decisions-2).
 */
export type Obligation = {
  id: string
  ticket: string
  at: string
  cites: string[]
  cards: string[]
  /** Set when the pass recorded "no new decision": the cards its choices came from. #werk-cli-followed */
  followed?: string[]
}

export type Graph = {
  /** Live nodes and ghosts. A removed node is not here — it is in `removed`. */
  nodes: Map<string, GraphNode>
  /** Live edges only: both ends exist and neither is a ghost. Everything derived reads
   *  this, so a ghost changes no count, no staleness and no rollup. */
  edges: Edge[]
  /** Edges with a ghost at one end or both. They go live when the ghost is accepted, and
   *  vanish with it when it is discarded. The map draws them; nothing derives from them. */
  ghostEdges: Edge[]
  /** Proposed, not accepted. A subset of `nodes` keys. See #werk-propose-new. */
  proposed: Set<string>
  /** Removed from the map, newest first. Still in the log, restorable. See #werk-remove. */
  removed: Removed[]
  /** Per-node conversation, keyed by node id. Derived from note.added events. */
  notes: Map<string, Note[]>
  /** Derived, never stored. Reverse-closure of a reopen with reason invalidated|rejected. */
  stale: Set<string>
  /** Derived, never stored. Reverse-closure of a reopen with reason postponed. */
  postponed: Set<string>
  /** Derived, never stored. Cards whose own latest reopen is postponed and that are not decided
   *  again. The origin of a postponement, which `postponed` never holds. See #pr-wf-paused. */
  postponedOrigins: Set<string>
  /** Derived, never stored. Why each flagged card is flagged. One entry per reopen it inherits. */
  flagWhy: Map<string, FlagTrace[]>
  /** Derived, never stored. For each stale card, the depends_on links a confirm must list: those
   *  made before its newest stale mark. See #vi-prop-confirm-names. */
  unread: Map<string, { to: string; why?: string }[]>
  /** stale ∪ postponed, ordered so a card's flagged depends_on targets come before it. */
  rederiveOrder: string[]
  /** The latest reopen recorded directly on each id that was ever reopened. Not the closure. */
  reopens: Map<string, Reopen>
  /** `who: you`, decided, and no option was ever put against it. See #al-two. */
  unchallenged: Set<string>
  /** Derived, never stored. One entry per card. */
  rollup: Map<string, Rollup>
  /** Card obligations by id, each with the live or ghost cards that answer it. */
  obligations: Map<string, Obligation>
}
