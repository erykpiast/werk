import type { Edge, Event, FlagTrace, Graph, GraphNode, Note, Obligation, Removed, Reopen, ReopenReason, Rollup } from './types.ts'
import { applyOps, verifyOps } from '../web/diff.js'

/**
 * Fold the event log into a graph.
 *
 * The graph is derived, cached and disposable. The log is the truth.
 * Nothing is ever deleted: a removal is an event.
 */
export function fold(events: Event[]): Graph {
  const nodes = new Map<string, GraphNode>()
  const allEdges: Edge[] = []
  /** Removed ids, and when. Applied after the loop, so a restore is just a deletion here. */
  const removedAt = new Map<string, string>()
  const reopenedAt = new Map<string, { seq: number; reason: ReopenReason; why?: string; at: string }>()
  const rederivedAt = new Map<string, number>()
  /** When each live link was made. A link newer than a reopen carries no mark from it —
   *  #vi-prop-bornstale. Keyed `from to type`. */
  const linkedAt = new Map<string, number>()
  const notes = new Map<string, Note[]>()
  const obligations = new Map<string, Obligation>()

  const sameEdge = (a: Edge, b: Edge) => a.from === b.from && a.to === b.to && a.type === b.type
  /** The parent each ghost was proposed under, so a discard takes that edge with it. */
  const placedBy = new Map<string, string>()
  const placeUnder = (id: string, parent: string, seq: number) => {
    const edge: Edge = { from: id, to: parent, type: 'refines' }
    if (!allEdges.some((x) => sameEdge(x, edge))) allEdges.push(edge)
    linkedAt.set(`${id} ${parent} refines`, seq)
    placedBy.set(id, parent)
  }

  for (const e of events) {
    const p = e.payload ?? {}
    switch (e.type) {
      // A card added under a parent is one event: the payload names the parent, and the
      // refines edge comes from it at the same seq — #pr-log-one-event. Old logs carry a
      // separate edge.added instead, and fold the same.
      case 'node.added': {
        const { id, parent, ...rest } = p
        nodes.set(id, { id, ...rest })
        if (parent) placeUnder(id, parent, e.seq)
        break
      }
      // A ghost: in the log, in `nodes`, out of every derivation until it is accepted.
      // It never overwrites a node that is already there — a pending card is frozen, so
      // the only way to change one is discard (which deletes it) and propose again.
      case 'node.proposed': {
        const { id, parent, citedBy, ...rest } = p
        if (nodes.has(id)) break
        // An excerpt whose span is not as long as its words is set aside, so a pointer and
        // its words always agree — #werk-excerpt-event-span.
        if (rest.kind === 'excerpt') {
          const whole = (n: unknown) => Number.isInteger(n) && (n as number) >= 0
          const [start, end] = Array.isArray(rest.span) ? rest.span : []
          if (!whole(rest.msgIndex) || !whole(start) || !whole(end) || typeof rest.text !== 'string' || end - start !== rest.text.length) break
          // A quote that marks its pointer as whole carries every part of it. An older
          // excerpt has no mark and keeps loading — #werk-excerpt-event-shape.
          if (rest.pointerWhole === true) {
            const part = (v: unknown) => typeof v === 'string' && v !== ''
            if (![rest.conversation, rest.session, rest.speaker, rest.saidAt].every(part)) break
          }
        }
        nodes.set(id, { id, ...rest, proposed: true })
        if (parent) placeUnder(id, parent, e.seq)
        // A quote is one event too: the excerpt and the supported_by link from the card it
        // was quoted for — #werk-excerpt-event. The link ends with either end, as every link.
        if (citedBy) {
          const edge: Edge = { from: citedBy, to: id, type: 'supported_by' }
          if (!allEdges.some((x) => sameEdge(x, edge))) allEdges.push(edge)
          linkedAt.set(`${citedBy} ${id} supported_by`, e.seq)
        }
        break
      }
      case 'node.removed':
        removedAt.set(p.id, e.at)
        break
      case 'node.restored':
        removedAt.delete(p.id)
        break
      case 'node.retitled': {
        const n = nodes.get(p.id)
        if (n) n.title = p.title
        break
      }
      case 'node.bodyEdited': {
        const n = nodes.get(p.id)
        if (n) Object.assign(n, p.patch ?? { body: p.body })
        break
      }
      case 'edge.added': {
        // Linking an existing edge again with a reason sets the reason — #vi-prop-linkwhy.
        // Without one it changes nothing, so an old replayed link never erases a reason.
        const edge: Edge = { from: p.from, to: p.to, type: p.type }
        if (p.why) edge.why = p.why
        const had = allEdges.find((x) => sameEdge(x, edge))
        if (!had) {
          allEdges.push(edge)
          linkedAt.set(`${p.from} ${p.to} ${p.type}`, e.seq)
        } else if (p.why) had.why = p.why
        break
      }
      case 'edge.removed': {
        const i = allEdges.findIndex((x) => sameEdge(x, { from: p.from, to: p.to, type: p.type }))
        if (i >= 0) allEdges.splice(i, 1)
        linkedAt.delete(`${p.from} ${p.to} ${p.type}`)
        break
      }
      case 'status.set': {
        const n = nodes.get(p.id)
        if (n) n.status = p.status
        break
      }
      case 'kill.added': {
        const n = nodes.get(p.id)
        if (n) n.kill = [...(n.kill ?? []), p.criterion]
        break
      }
      case 'kill.cleared': {
        const n = nodes.get(p.id)
        if (n) n.kill = undefined
        break
      }
      case 'kill.state': {
        const c = nodes.get(p.id)?.kill?.[p.index]
        if (c) {
          c.state = p.state
          c.detail = p.detail
        }
        break
      }
      case 'reopened': {
        const n = nodes.get(p.id)
        if (n) n.status = 'open'
        // Missing on old log lines. Read as invalidated, so old history keeps its old meaning.
        reopenedAt.set(p.id, { seq: e.seq, reason: p.reason ?? 'invalidated', why: p.why, at: e.at })
        break
      }
      case 'rederived': {
        rederivedAt.set(p.id, e.seq)
        if (p.status) {
          const n = nodes.get(p.id)
          if (n) n.status = p.status
        }
        break
      }
      case 'option.chosen': {
        // The option becomes the live decision. The old body is kept as an option node.
        const card = nodes.get(p.card)
        const option = nodes.get(p.option)
        if (card && option) {
          card.title = option.title
          card.body = option.body ?? card.body
          option.why_not = undefined
        }
        break
      }
      case 'change.proposed': {
        const n = nodes.get(p.id)
        if (!n) break
        if (p.remove) {
          n.pending = { remove: true, reparent: p.reparent === true }
          break
        }
        // Verified fresh on every fold, against the body as folded so far — not trusted
        // from whatever the log recorded at propose time. See #al-diff-cli.
        const { ops, rejected } = p.ops ? verifyOps(n.body ?? '', p.ops) : { ops: undefined, rejected: [] }
        n.pending = { title: p.title, why: p.why, ops, rejected, ...(p.facts ? { facts: p.facts } : {}) }
        break
      }
      case 'change.accepted': {
        const n = nodes.get(p.id)
        // Two things wear the same verb: a ghost node becoming real, and a staged edit
        // committing. One accept button, one CLI verb, either meaning. #werk-propose-new.
        if (n?.proposed) {
          n.proposed = undefined
          break
        }
        if (n?.pending) {
          // The accept of a change to a decided card is an amend. It marks the next hop like a
          // reopen does, and the card stays decided — #map-frozen, #vi-prop-amended.
          if (n.status === 'decided' && !n.pending.remove) {
            reopenedAt.set(p.id, { seq: e.seq, reason: 'amended', at: e.at })
            // The amend is the review of the card itself, so its older marks clear.
            rederivedAt.set(p.id, e.seq)
          }
          if (n.pending.title !== undefined) n.title = n.pending.title
          if (n.pending.why !== undefined) n.why = n.pending.why
          if (n.pending.ops?.length) n.body = applyOps(n.pending.ops)
          if (n.pending.facts) Object.assign(n, n.pending.facts)
          n.pending = undefined
        }
        break
      }
      case 'change.discarded': {
        const n = nodes.get(p.id)
        // A discarded ghost leaves nothing behind, so the same id can be proposed again
        // with different words. That is the only way to correct a frozen pending card.
        if (n?.proposed) {
          nodes.delete(p.id)
          // The parent came with the proposal, so it goes with it. A new proposal of the
          // same id names its own parent.
          const parent = placedBy.get(p.id)
          if (parent) {
            const i = allEdges.findIndex((x) => sameEdge(x, { from: p.id, to: parent, type: 'refines' }))
            if (i >= 0) allEdges.splice(i, 1)
            linkedAt.delete(`${p.id} ${parent} refines`)
            placedBy.delete(p.id)
          }
          break
        }
        if (n) n.pending = undefined
        break
      }
      case 'note.added': {
        const list = notes.get(p.node) ?? []
        list.push({ seq: e.seq, at: e.at, node: p.node, from: e.actor, text: p.text })
        notes.set(p.node, list)
        break
      }
      case 'obligation.created':
        obligations.set(p.id, { id: p.id, ticket: p.ticket, at: e.at, cites: p.cites ?? [], cards: [] })
        break
      case 'obligation.followed': {
        // The first record wins. The command refuses a second one, so a later one is a
        // hand-written log line, not a correction.
        const o = obligations.get(p.id)
        if (o && !o.followed) o.followed = p.cards ?? []
        break
      }
      case 'level.moved': {
        // Re-parent in the refines tree. refines goes child -> parent.
        for (let i = allEdges.length - 1; i >= 0; i--) {
          if (allEdges[i].type === 'refines' && allEdges[i].from === p.id) allEdges.splice(i, 1)
        }
        if (p.parent) {
          allEdges.push({ from: p.id, to: p.parent, type: 'refines' })
          linkedAt.set(`${p.id} ${p.parent} refines`, e.seq)
        }
        break
      }
    }
  }

  // A removed card leaves the map, not the log. Taking it out here, once, means nothing
  // downstream has to know about removal: no edge of a removed card is live, it counts in
  // no rollup, and it makes nothing stale. #werk-remove.
  const removed: Removed[] = []
  for (const [id, at] of removedAt) {
    const n = nodes.get(id)
    if (!n) continue
    // The refines parent, so a restore can refuse while that parent is still out.
    const parent = allEdges.find((x) => x.type === 'refines' && x.from === id)?.to
    removed.push({ id, title: n.title, kind: n.kind, at, ...(parent ? { parent } : {}) })
    nodes.delete(id)
  }
  removed.reverse()

  // Three kinds of edge come out of one list. An edge whose end is gone (removed, or a
  // discarded ghost) is gone with it. An edge touching a ghost is held: it is drawn, and
  // it goes live by itself the moment both ends are real. Everything else is live.
  const edges: Edge[] = []
  const ghostEdges: Edge[] = []
  for (const e of allEdges) {
    const from = nodes.get(e.from)
    const to = nodes.get(e.to)
    if (!from || !to) continue
    if (from.proposed || to.proposed) ghostEdges.push(e)
    else edges.push(e)
  }
  const proposed = new Set<string>([...nodes.values()].filter((n) => n.proposed).map((n) => n.id))

  // #st-build-card: a card answers an obligation by naming it. Derived from the nodes that
  // are left, so a discarded or removed card stops counting.
  for (const n of nodes.values()) {
    if (n.obligation) obligations.get(n.obligation)?.cards.push(n.id)
  }

  const { stale, postponed, flagWhy, unread } = deriveStaleness(edges, reopenedAt, rederivedAt, linkedAt, (id) => nodes.get(id)?.kind === 'card', (id) => nodes.get(id)?.status === 'decided')
  const rederiveOrder = topoOrderForRederive(edges, stale, postponed)
  const unchallenged = deriveUnchallenged(nodes, edges)
  // A reopen sets the card open, so a card that is decided now was decided after its last
  // reopen. That reopen is history, not a reason to flag the card's dependents.
  const reopens = new Map<string, Reopen>(
    [...reopenedAt]
      .filter(([id]) => nodes.get(id)?.status !== 'decided')
      .map(([id, r]) => [id, { reason: r.reason, why: r.why, at: r.at }]),
  )
  // A later decision ends the postponement; a later reopen overwrites its reason.
  const postponedOrigins = new Set(
    [...reopenedAt]
      .filter(([id, r]) => r.reason === 'postponed' && nodes.get(id)?.status !== 'decided')
      .map(([id]) => id),
  )

  return {
    nodes,
    edges,
    ghostEdges,
    proposed,
    removed,
    notes,
    stale,
    postponed,
    postponedOrigins,
    flagWhy,
    unread,
    rederiveOrder,
    reopens,
    unchallenged,
    // A postponed card counts as postponed in its parents' bars, the same as one downstream of
    // it (#pr-wf-postponed). Stale still wins, as it does on the mark.
    rollup: deriveRollup(nodes, edges, stale, new Set([...postponed, ...[...postponedOrigins].filter((id) => !stale.has(id))]), unchallenged),
    obligations,
  }
}

/**
 * The order to fix flagged cards in: a card's own depends_on targets, if they are also
 * flagged, come first. Fixing in this order never redoes work — you never rewrite a card
 * against a dependency that is itself still wrong. #vi-prop calls for this; nothing computed
 * it before now, so `werk stale` printed the two Sets in scan order instead.
 */
function topoOrderForRederive(edges: Edge[], stale: Set<string>, postponed: Set<string>): string[] {
  const flagged = new Set<string>([...stale, ...postponed])
  const successors = new Map<string, string[]>() // prerequisite -> [cards that depend on it]
  const inDegree = new Map<string, number>([...flagged].map((id) => [id, 0]))
  for (const e of edges) {
    if (e.type !== 'depends_on' || !flagged.has(e.from) || !flagged.has(e.to)) continue
    const list = successors.get(e.to) ?? []
    list.push(e.from)
    successors.set(e.to, list)
    inDegree.set(e.from, (inDegree.get(e.from) ?? 0) + 1)
  }

  const queue = [...flagged].filter((id) => inDegree.get(id) === 0)
  const order: string[] = []
  while (queue.length > 0) {
    const current = queue.shift()!
    order.push(current)
    for (const dependent of successors.get(current) ?? []) {
      const left = (inDegree.get(dependent) ?? 0) - 1
      inDegree.set(dependent, left)
      if (left === 0) queue.push(dependent)
    }
  }
  // A cycle in depends_on would leave nodes out of `order`. Append them so no card goes
  // missing from `werk stale` — cost of a cycle is losing the guarantee, not losing the card.
  for (const id of flagged) if (!order.includes(id)) order.push(id)
  return order
}

/**
 * A decided card whose author stated, with `--unchallenged`, that no option was weighed
 * against it. The map reads that statement and infers nothing — #werk-contract-guess. The
 * data cannot tell "no option weighed" from "weighed and never written down"; only the
 * author can. See #al-two: one option turns a decision into a rubber stamp.
 *
 * An option linked later answers the statement, so a challenged card is not flagged.
 *
 * This is the one definition. The rollup counts this set; it does not re-derive it.
 */
function deriveUnchallenged(nodes: Map<string, GraphNode>, edges: Edge[]): Set<string> {
  const challenged = new Set(edges.filter((e) => e.type === 'alternative_to').map((e) => e.to))
  const flagged = new Set<string>()
  for (const [id, n] of nodes) {
    // A ghost is not a decision yet. Flagging one would put a red ring on a card nobody
    // has accepted.
    if (n.proposed) continue
    if (n.kind !== 'card' || n.status !== 'decided' || !n.noAlternative) continue
    if (!challenged.has(id)) flagged.add(id)
  }
  return flagged
}

/**
 * #vi-prop: a reopen marks the next hop only — the cards that depend on it, and its own
 * child cards. A child is reached through its refines edge, so a depends_on link to an
 * ancestor is never needed (#vi-prop-nolineage). Every marked card is stale unless it was
 * rederived after the reopen.
 *
 * A reopen with reason `postponed` marks `postponed`, not `stale`: the card still holds, it is
 * just not being worked on. A postponed card is never reviewed, so a postponement that stopped
 * at the first hop would stop there for good. It goes every distance (#pr-wf-paused). If two
 * reopens disagree on one card, stale wins over postponed — a real invalidation is never
 * allowed to look calm.
 */
function deriveStaleness(
  edges: Edge[],
  reopenedAt: Map<string, { seq: number; reason: ReopenReason; why?: string; at: string }>,
  rederivedAt: Map<string, number>,
  linkedAt: Map<string, number>,
  isCard: (id: string) => boolean,
  isDecided: (id: string) => boolean = () => false,
): { stale: Set<string>; postponed: Set<string>; flagWhy: Map<string, FlagTrace[]>; unread: Map<string, { to: string; why?: string }[]> } {
  const dependents = new Map<string, { id: string; type: 'depends_on' | 'refines' }[]>() // to -> from
  const reasonOf = new Map<string, string>() // `${from} ${to}` -> why
  for (const e of edges) {
    // An option or a source sits under a card too, but it holds no decision to review.
    if (e.type !== 'depends_on' && !(e.type === 'refines' && isCard(e.from))) continue
    const list = dependents.get(e.to) ?? []
    list.push({ id: e.from, type: e.type })
    dependents.set(e.to, list)
    if (e.why) reasonOf.set(`${e.from} ${e.to}`, e.why)
    else if (e.type === 'refines') reasonOf.set(`${e.from} ${e.to}`, `A child card. It refines #${e.to}.`)
  }

  const stale = new Set<string>()
  const postponed = new Set<string>()
  const flagWhy = new Map<string, FlagTrace[]>()
  const newestMark = new Map<string, number>() // stale card -> seq of its newest mark
  for (const [origin, { seq, reason, why, at }] of reopenedAt) {
    const kind = reason === 'postponed' ? 'postponed' : 'stale'
    const target = kind === 'postponed' ? postponed : stale
    // A postponement ends when its card is decided again — #vi-prop-review-clears-stale.
    if (kind === 'postponed' && isDecided(origin)) continue
    const queue = [origin]
    const seen = new Set<string>([origin])
    // Who put each node in the queue. BFS, so the first parent found is on a shortest path —
    // the path the reader has the best chance of already holding in their head.
    const cameFrom = new Map<string, string>()
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const { id: dependent, type } of dependents.get(current) ?? []) {
        if (seen.has(dependent)) continue
        // #vi-prop-bornstale: the link was written against the text as it is after this
        // change, so nothing reaches past it. Not marked as seen: an older path may still.
        if ((linkedAt.get(`${dependent} ${current} ${type}`) ?? 0) > seq) continue
        seen.add(dependent)
        cameFrom.set(dependent, current)
        if (kind === 'postponed') queue.push(dependent)
        // A review clears stale marks only. A paused mark waits for its postponement to end.
        if (kind === 'stale' && (rederivedAt.get(dependent) ?? 0) >= seq) continue
        target.add(dependent)
        if (kind === 'stale') newestMark.set(dependent, Math.max(newestMark.get(dependent) ?? 0, seq))
        // Walk back up the parents. The chain ends at `origin`, which has no parent of its
        // own, so the loop already puts it last — [p1, p2, ..., origin].
        const via: string[] = []
        for (let hop = cameFrom.get(dependent); hop; hop = cameFrom.get(hop)) via.push(hop)
        const list = flagWhy.get(dependent) ?? []
        list.push({
          kind,
          origin,
          reason,
          at,
          why,
          via,
          whys: via.map((to, i) => reasonOf.get(`${i === 0 ? dependent : via[i - 1]} ${to}`) ?? null),
        })
        flagWhy.set(dependent, list)
      }
    }
  }
  // Stale wins over postponed on the mark, so it must win in the explanation too — otherwise a
  // card reads "stale" and the block under it only talks about a postponement.
  for (const id of stale) postponed.delete(id)
  for (const [id, list] of flagWhy) {
    if (stale.has(id)) flagWhy.set(id, list.filter((t) => t.kind === 'stale'))
  }
  // #vi-prop-confirm-names: a confirm of a stale card must list every depends_on target whose
  // link is older than the card's newest stale mark. A newer link was written against the text
  // as it is now, so it has nothing to read.
  const unread = new Map<string, { to: string; why?: string }[]>()
  for (const id of stale) {
    const newest = newestMark.get(id) ?? 0
    const links = edges
      .filter((e) => e.type === 'depends_on' && e.from === id && (linkedAt.get(`${id} ${e.to} depends_on`) ?? 0) <= newest)
      .map((e) => ({ to: e.to, why: e.why }))
    unread.set(id, links)
  }
  return { stale, postponed, flagWhy, unread }
}

/**
 * One rollup per card, over its refines subtree, the card included.
 *
 * Status answers for one card. This answers for the branch: is the subtree
 * finished, or barely started? A branch can be all green and still be drained
 * rather than settled. See #drained.
 *
 * "unchallenged" counts a `who: you` card that was decided with no option
 * against it. Only `who: you` counts. A `who: me` card is a reversible call the
 * agent made and reported, and a `who: prototype` card is answered by building.
 * Neither has an alternative to present, so counting them buried the signal:
 * on the first run the count read 44 of 49, which ranks nothing. See #ro-unchal
 * and #al-two.
 *
 * Cost is O(nodes * average subtree size). The maps stay small, so a plain
 * walk per card beats a memo that has to be invalidated.
 */
function deriveRollup(
  nodes: Map<string, GraphNode>,
  edges: Edge[],
  stale: Set<string>,
  postponed: Set<string>,
  unchallenged: Set<string>,
): Map<string, Rollup> {
  const children = new Map<string, string[]>() // parent -> [child]
  for (const e of edges) {
    if (e.type !== 'refines') continue
    const list = children.get(e.to) ?? []
    list.push(e.from)
    children.set(e.to, list)
  }

  const rollup = new Map<string, Rollup>()
  for (const [id, node] of nodes) {
    if (node.kind !== 'card' || node.proposed) continue
    const counts: Rollup = {
      cards: 0,
      open: 0,
      proto: 0,
      decided: 0,
      yours: 0,
      unchallenged: 0,
      stale: 0,
      postponed: 0,
      openPostponed: 0,
      protoPostponed: 0,
      decidedPostponed: 0,
    }
    const queue = [id]
    const seen = new Set<string>([id]) // a refines cycle must not hang the walk
    while (queue.length > 0) {
      const current = queue.shift()!
      const n = nodes.get(current)
      if (n?.kind === 'card') {
        counts.cards++
        const isPostponed = postponed.has(current)
        if (n.status === 'open') {
          counts.open++
          if (isPostponed) counts.openPostponed++
        } else if (n.status === 'proto') {
          counts.proto++
          if (isPostponed) counts.protoPostponed++
        } else if (n.status === 'decided') {
          counts.decided++
          if (isPostponed) counts.decidedPostponed++
          // The population for the ratio: a decision that was yours to make. A who:me
          // or who:prototype card has no alternative to present, so it is not a miss.
          if (n.who === 'you') counts.yours++
          if (unchallenged.has(current)) counts.unchallenged++
        }
        if (stale.has(current)) counts.stale++
        if (isPostponed) counts.postponed++
      }
      for (const child of children.get(current) ?? []) {
        if (seen.has(child)) continue
        seen.add(child)
        queue.push(child)
      }
    }
    rollup.set(id, counts)
  }
  return rollup
}

/** The wire shape the browser reads. Maps and Sets do not survive JSON. */
export function toJSON(graph: Graph) {
  return {
    nodes: [...graph.nodes.values()],
    edges: graph.edges,
    ghostEdges: graph.ghostEdges,
    proposed: [...graph.proposed],
    removed: graph.removed,
    notes: Object.fromEntries(graph.notes),
    stale: [...graph.stale],
    postponed: [...graph.postponed],
    postponedOrigins: [...graph.postponedOrigins],
    flagWhy: Object.fromEntries(graph.flagWhy),
    reopens: Object.fromEntries(graph.reopens),
    unchallenged: [...graph.unchallenged],
    rollup: Object.fromEntries(graph.rollup),
    obligations: [...graph.obligations.values()],
  }
}
