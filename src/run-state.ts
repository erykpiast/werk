/**
 * The pure half of the merge loop: what it reads back off the board. Split from run.ts so the
 * 90% line gate can hold it without holding git and the agents — see
 * #werk-test-scope-src0-pure-scope.
 */
import type { BoardEvent, BoardEventMap, Ticket } from './board.ts'
import type { Failure } from './build-prompt.ts'
import type { Step } from './heldout-text.ts'
import { touchesOverlap } from './ticket.ts'

/** The failure a red merge left for the ticket's next build, read back off the board. */
export function mergeFailure(t: Ticket): Failure | undefined {
  const m = t.lastMerge
  if (!m || m.green) return undefined
  return { kind: 'merge', cmd: m.cmd ?? '?', code: m.code ?? -1, tail: m.detail ?? '', ...(m.conflict ? { conflict: true } : {}) }
}

/** The merges after which git could not merge a ticket in a row that stop the merge loop as
 *  stuck, so a conflict that never resolves cannot run without end (#st-build-conflict). */
export const CONFLICT_LIMIT = 10

/** What the ticket's next build starts from, and the failure its first pass reads.
 *
 *  - A build whose process died goes on from its own branch, which holds every pass it
 *    committed, and the death is its failure (#st-build-died).
 *  - A green build that never merged — the merge loop stopped while the ticket was in
 *    merging (#st-build-stop-ready) — goes on from its own branch, with no failure.
 *  - After a conflict, the build starts on the branch the merge took, with the main line's
 *    tip merged into it, and the conflict output as its failure (#st-build-conflict-resolve).
 *  - After a red check on the merged tree, it starts from the branch the merge took
 *    (#st-build-run-mechanics).
 *
 *  A `startFrom` branch is only a candidate: the build uses it only when it sits on the main
 *  line's tip, and starts fresh otherwise. */
export function resumeOf(t: Ticket): { startFrom?: string; resolveFrom?: string; lastFailure?: Failure } {
  const own = t.loopRun ? `werk-build/${t.loopRun}` : undefined
  // #st-build-died: a build whose process died goes on from the passes it committed.
  if (t.lastEnd === 'died' && own) return { startFrom: own, lastFailure: { kind: 'died', detail: 'the build process died mid-pass' } }
  if (t.lastEnd === 'green' && own && t.lastMerge?.branch !== own) return { startFrom: own }
  const lastFailure = mergeFailure(t)
  if (!lastFailure) return {}
  const branch = t.lastMerge!.branch
  if (t.lastMerge!.conflict) return branch ? { resolveFrom: branch, lastFailure } : { lastFailure }
  return { startFrom: branch, lastFailure }
}

/** #st-build-conflict-resolve: the ticket the merge queue takes next. A ticket whose last
 *  merge conflicted comes back from its conflict pass first, so no other merge moves the main
 *  line under it again; the rest go in the board's order. */
export function nextToMerge(merging: Ticket[]): Ticket | undefined {
  return merging.find((t) => t.lastMerge?.conflict) ?? merging[0]
}

/** #st-build-stuck-park: the hold on a ticket that hit its retry cap or its conflict limit. It
 *  keeps the ticket in blocked, and with it every ticket that needs it, until a person moves it
 *  to ready. */
export const STUCK_HOLD = 'stuck'

/** The tickets that need `id`, directly or through others. */
export function dependentsOf(tickets: Ticket[], id: string): string[] {
  const out = new Set<string>()
  const visit = (of: string) => {
    for (const t of tickets) {
      if (!t.blockedBy.includes(of) || out.has(t.id)) continue
      out.add(t.id)
      visit(t.id)
    }
  }
  visit(id)
  return [...out]
}

/** #st-build-run-cap: the passes a ticket's next build may use. A pass after a conflict does
 *  not count against the cap (#st-build-conflict): every conflict gives one pass back. Nor does
 *  a pass that ended on a spec gap (#st-build-cap-spec-gap). */
export function passesLeft(t: Ticket, cap: number): number {
  return cap - (t.passes - t.conflicts - t.freePasses - t.spentBefore)
}

/**
 * The next ticket to start beside the builds in flight, if one may (#st-build-parallel).
 *
 * The order: a ticket already in building — a person's trigger, or a red merge — then the
 * tickets a stopped merge loop returned to ready (#st-build-stop-ready), then the rest of
 * ready, each group in the board's order. A ticket starts only when its modules share none
 * with a build in flight or a ticket in merging; one that overlaps waits, and a later one may
 * start in its place.
 */
export function nextToBuild(tickets: Ticket[], inFlight: (id: string) => boolean, touchesOf: (t: Ticket) => string[]): Ticket | undefined {
  const inColumn = (c: Ticket['column']) =>
    tickets.filter((t) => t.column === c && !t.archived).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  const ready = inColumn('ready')
  const busy = tickets.filter((t) => inFlight(t.id) || t.column === 'merging').map(touchesOf)
  const order = [...inColumn('building'), ...ready.filter((t) => t.loopStop), ...ready.filter((t) => !t.loopStop)]
  return order.filter((t) => !inFlight(t.id)).find((t) => {
    const own = touchesOf(t)
    return busy.every((other) => !touchesOverlap(own, other))
  })
}

/** The held-out steps a run after a merge holds: those of the run's tickets that are merged
 *  onto the main line and not archived (#st-heldout-merged-only). A step of a ticket still
 *  building describes code nobody merged, and one of an archived ticket describes code no
 *  ticket will build. */
export function mergedSteps(steps: Step[], tickets: Ticket[]): Step[] {
  const merged = new Set(tickets.filter((t) => t.column === 'done' && !t.archived).map((t) => t.id))
  return steps.filter((s) => merged.has(s.ticket))
}

/** The held-out result on the main line's tip: the last one recorded after the run's last
 *  green merge, for that merge's ticket. Held-out runs go on beside the merge queue and can end
 *  out of order, so a later result can belong to an older commit (#st-heldout-beside). Unset
 *  when the last merge has no result yet. */
export function lastHeldout(events: BoardEvent[], tickets: Ticket[]) {
  const mine = ofTickets(events, tickets)
  const at = mine.findLastIndex(isGreenMerge)
  const after = at < 0 ? mine : mine.slice(at + 1)
  const id = at < 0 ? undefined : (mine[at].payload as { id: string }).id
  const hit = after.filter((e) => e.type === 'ticket.heldout' && (id === undefined || (e.payload as { id: string }).id === id)).at(-1)
  return hit?.payload as BoardEventMap['ticket.heldout'] | undefined
}

/** The id of the run's ticket whose green merge moved the main line last. */
export function lastMerged(events: BoardEvent[], tickets: Ticket[]): string | undefined {
  const hit = ofTickets(events, tickets).findLast(isGreenMerge)
  return hit ? (hit.payload as { id: string }).id : undefined
}

const isGreenMerge = (e: BoardEvent) => e.type === 'ticket.merge' && (e.payload as BoardEventMap['ticket.merge']).green

function ofTickets(events: BoardEvent[], tickets: Ticket[]): BoardEvent[] {
  const ids = new Set(tickets.map((t) => t.id))
  return events.filter((e) => ids.has((e.payload as { id?: string }).id ?? ''))
}

/** The open follow-up of one kind for a merged ticket: a step follow-up carries held-out steps,
 *  a rework follow-up reworks a changed decision (#st-followup-one-open). `started` says it left
 *  ready and blocked, so its file can no longer take more. */
export function openFollowUp(tickets: Ticket[], source: string, kind: 'steps' | 'rework'): { ticket: Ticket; started: boolean } | undefined {
  const open = tickets.find((t) => !t.archived && t.column !== 'done' && t.followUpOf === source && (kind === 'rework' ? t.rework : !t.rework && !!t.steps?.length))
  return open && { ticket: open, started: open.column !== 'ready' && open.column !== 'blocked' }
}
