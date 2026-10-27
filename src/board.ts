/**
 * The ticket board's state. See #vi-board, #werk-board-columns, #werk-board-control.
 *
 * Tickets are units of build work, not decisions (#st-ticket), so their state does not go in
 * .werk/log.jsonl. It goes in its own append-only file, .werk/board.jsonl, with the same
 * {seq, at, actor, type, payload} shape. foldBoard() is pure: the same events give the same
 * board, and the server, the CLI and the build loop all read it the same way.
 *
 * A ticket id is "<subtree id>/<NN>", for example "st-build-steps/03". The ticket's text stays
 * in .werk/tickets/<subtree id>/<NN>.md; this file holds only where the ticket is and what
 * happened to it. A later plan of the same subtree extends the same tickets (#st-plan-extend).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { paths } from './project.ts'
import type { CardPrint } from './ticket-watch.ts'

/** The check name a cited-card change holds a ticket with (#st-ticket-watch). A later plan's
 *  record of the cited cards lifts it. */
export const CITED_CHANGED = 'cited-changed'

export const COLUMNS =['blocked', 'ready', 'building', 'merging', 'done'] as const
export type Column = (typeof COLUMNS)[number]

/** How one build session of a ticket ended. `died`: its process was gone with the session
 *  still open, and the server wrote the end (#st-build-died). */
export type BuildEnd = 'green' | 'red' | 'cap' | 'stopped' | 'silence' | 'error' | 'died'

/** The step of `werk plan` that runs now (#vi-board-plan). */
export type PlanStep = 'spec' | 'tickets' | 'checks'
/** A follow-up is a plan miss or a build miss, found at review or after merge (#ms-outcome-followup). */
export type FollowUpClass = 'plan' | 'build'
export type FollowUpFound = 'review' | 'after-merge'
/** How one `werk plan` ended. `error` is a throw the plan did not expect. */
export type PlanEnd = 'ok' | 'blocked' | 'agent-error' | 'spec-invalid' | 'error'
/** The color of a plan card (#vi-board-plan). Creating while its agents run, stopped when the
 *  last plan did not end ok, then building until every ticket of the plan is done or archived. */
export type PlanState = 'creating' | 'stopped' | 'building' | 'done'

export type BoardEventMap = {
  /** `werk plan` wrote this ticket. It enters blocked or ready, from its blocked_by. */
  'ticket.planned': {
    id: string
    run: string
    file: string
    title: string
    blockedBy: string[]
    /** A follow-up for red held-out steps after this ticket's merge (#st-build-run). */
    followUpOf?: string
    /** The held-out step ids the follow-up exists to make green. */
    steps?: string[]
    /** The follow-up reworks a merged ticket after a decision it was built on changed
     *  (#st-followup-one-open). */
    rework?: true
  }
  /** A column change. `reason` is required for an agent's move between blocked and ready. */
  'ticket.moved': {
    id: string
    to: Column
    reason?: string
    /** The failed set check that holds the ticket in blocked (#st-ticket-partial). Only a move
     *  to ready lifts it. */
    check?: string
    /** How the merge loop ended, on its move of a ticket it left in building or merging back
     *  to ready (#st-build-stop-ready). The next loop builds such a ticket first. */
    loopStop?: string
  }
  /** The full order of the ready column after a person dragged one ticket. */
  'ticket.reordered': { ids: string[] }
  /** `reason` is set when a plan archived the ticket because the subtree's spec no longer needs
   *  it (#st-plan-archive). A person's archive carries none. */
  'ticket.archived': {
    id: string
    reason?: string
    /** The subtree whose restart ended this ticket's unfinished work (#werk-board-restart). A
     *  restart is a kind of stop, so the fact is structured, not read from the reason
     *  (#ms-outcome-interv). */
    restart?: string
  }
  'ticket.restored': { id: string }
  /** A later plan of the same subtree rewrote this open ticket in place (#st-plan-extend). */
  'ticket.revised': { id: string; title: string; blockedBy: string[]; steps?: string[] }
  /** A plan recorded the cards this ticket cites, as they were at the plan (#st-ticket-watch).
   *  It lifts a hold for a changed cited card: the plan kept or rewrote the ticket against
   *  the cards as they are now. */
  'ticket.cites': { id: string; cards: Record<string, CardPrint> }
  /** A green build recorded the cards this ticket's builds proposed, as they were then
   *  (#st-build-missing-decision). The ticket answers to them like to its cited cards. */
  'ticket.proposals': { id: string; cards: Record<string, CardPrint> }
  /** A proposal this merged ticket was built on changed or went, and `followUp` reworks it.
   *  `reason` names each change, so the same change files one follow-up only. */
  'ticket.decision-changed': { id: string; reason: string; followUp: string }
  /** A builder session started. `log` is the path of its live event stream, for the preview.
   *  `pid` is the `werk build` process, so a stop can reach it after a server restart; `group`
   *  says it leads its own process group (the board spawned it detached), so the stop signals
   *  the group, the builder's children included. */
  'ticket.build.started': { id: string; loopRun: string; log?: string; pid?: number; group?: boolean }
  /** One builder pass finished. Retries are counted from these. */
  /** `free`: this pass ended on a spec gap. `freed`: this pass named the pass before it a spec
   *  gap. Neither counts against the cap (#st-build-cap-spec-gap). */
  'ticket.pass': { id: string; loopRun: string; pass: number; green: boolean; free?: true; freed?: number }
  'ticket.build.ended': { id: string; loopRun: string; result: BuildEnd; detail?: string }
  /** The merge queue tried this ticket on the main line (#st-build-run). Red sends it back
   *  to building; `detail` is the failure its next pass reads. `conflict`: git could not
   *  merge the branch at all, before any check ran (#st-build-conflict). `failedChecks`: the
   *  checks that were red on a green merge; a follow-up ticket fixes them (#ms-merge-red-follow-up). */
  'ticket.merge': { id: string; green: boolean; commit?: string; branch?: string; cmd?: string; code?: number; detail?: string; conflict?: boolean; failedChecks?: string[] }
  /** The step author wrote this ticket's held-out steps, or failed to (#lp-heldout-author). */
  /** `rewritten`: the source cards that changed, when the step author rewrote the steps
   *  (#st-heldout-step-fresh). */
  'ticket.steps': { id: string; file?: string; count: number; error?: string; rewritten?: string[] }
  /** The held-out set ran after this ticket's merge (#st-g2-heldout). `failed` names the red
   *  steps; `binderErrors` the steps the binder could not run, which are not run, not red, and
   *  file no follow-up (#st-heldout-notrun). */
  'ticket.heldout': { id: string; green: boolean; failed?: string[]; followUp?: string; followUps?: string[]; binderErrors?: string[] }
  /** The person asked to change the work this done ticket delivered (#ms-outcome-followup). The
   *  chat agent records it. `catchable` is set for a build miss only (#ms-outcome-escape).
   *  `of` makes this record a correction of the ticket's record number `of`, counted from 1. */
  'ticket.followup': { id: string; class: FollowUpClass; found: FollowUpFound; why: string; catchable?: boolean; of?: number }
  /** Written at the start of every `werk run`. v0 always records feature (#werk-loop-tier,
   *  #st-tier-default): silence means feature, and the event is written anyway. */
  'run.tier': { run: string; tier: 'feature' }
  /** A `werk run` process took this run. While `pid` is alive, the board's trigger only moves
   *  a ticket to building, and that run builds it (#werk-board-control). */
  'run.started': { run: string; pid: number }
  /** `proposals`: the cards the run's builders proposed that still wait for a person
   *  (#st-build-missing-decision). */
  'run.ended': { run: string; end: string; proposals?: string[]; detail?: string }
  /** `werk plan` started on the subtree `run` (#vi-board-plan). `pid` lets the board tell a
   *  plan that died without ending from one that still runs. */
  'plan.started': { run: string; pid?: number }
  /** The map's Build button started a plan and then the merge loop over the subtree `run`, as
   *  one detached process that leads its own process group (#werk-board-build-subtree). */
  'build.started': { run: string; pid: number }
  /** That process ended, or a person stopped it. */
  'build.ended': { run: string; detail?: string }
  /** The plan moved to a step. `log` is the stream-event log of that step's agent. */
  'plan.step': { run: string; step: PlanStep; log?: string }
  /** The plan ended. `step` names the agent of an agent error. */
  'plan.ended': { run: string; result: PlanEnd; step?: PlanStep; detail?: string; planned?: string[]; archived?: string[] }
  /** The cards-cited check over the plan's current scope, after a map change. It blocks no
   *  ticket, because it names none (#st-ticket-partial, #st-ticket-watch). */
  'run.cited': { run: string; ok: boolean; detail: string }
  /** The project's target repository, where every ticket builds and merges (#st-build-target).
   *  An absolute path, set with `werk target`. The last one holds. There is no default. */
  'project.target': { repo: string }
  /** A gate stopped the run and waits for a person, for the run tree at `tip`. */
  'gate.waiting': { run: string; gate: Gate; tip: string; reason: string }
  /** A person passed the gate for the run tree at `tip`. */
  'gate.passed': { run: string; gate: Gate; tip: string }
}

export type BoardEventType = keyof BoardEventMap

/** The gates of #st-gates. v0 runs only G2, at the end of build. */
export type Gate = 'G1' | 'G2' | 'G3'

export type BoardEvent<T extends BoardEventType = BoardEventType> = {
  seq: number
  at: string
  actor: 'you' | 'agent'
  type: T
  payload: BoardEventMap[T]
}

export type Ticket = {
  id: string
  run: string
  file: string
  title: string
  blockedBy: string[]
  column: Column
  /** Rank inside its column. Only the ready column is ordered by hand. */
  order: number
  archived: boolean
  /** The reason given with the last move that had one: an agent's move between blocked and
   *  ready, a red merge sent back to building, or a refused build sent back to ready. */
  reason?: string
  /** When the ticket entered its current column. Drives the drawer's time-in-column counter. */
  since: string
  /** True while a builder session runs. Drives the pulse. */
  live: boolean
  /** When the live session started. Cleared with live. */
  liveSince?: string
  loopRun?: string
  log?: string
  /** The running `werk build` process, while a session is live, and whether it leads its own
   *  process group. Cleared when the session ends or the ticket leaves building. */
  pid?: number
  pidGroup?: boolean
  /** Builder passes across every session of this ticket. A retry is every pass after the first. */
  passes: number
  /** The failed passes that ended on a spec gap: they do not count against the cap
   *  (#st-build-cap-spec-gap). */
  freePasses: number
  /** The passes that counted against the cap when a person last moved the ticket out of a
   *  stuck stop. The next builds start a new budget from there (#st-build-stuck-retry). */
  spentBefore: number
  lastEnd?: BuildEnd
  /** Ids in blocked_by that are not done yet. */
  openBlockers: string[]
  /** A failed set check holds the ticket in blocked, done blockers or not (#st-ticket-partial). */
  heldBy?: string
  /** A held-out step that ran after this ticket's merge failed. */
  heldOutRed: boolean
  heldOutFailed: string[]
  /** The steps the binder could not run after this ticket's merge: not red, not green
   *  (#st-heldout-notrun). Each entry is the step and the binder's reason. */
  heldOutNotRun: string[]
  /** The follow-ups the last held-out run after this merge filed, one per source ticket of its
   *  red steps (#st-heldout-followup-per-ticket). `followUp` is the first, for the badge. */
  followUps?: string[]
  followUp?: string
  followUpOf?: string
  rework?: true
  steps?: string[]
  /** The last merge-queue try and the ticket branch it took. */
  lastMerge?: BoardEventMap['ticket.merge']
  /** Every merge of this ticket that git could not make, and how many came in a row with no
   *  other merge result between them (#st-build-conflict). */
  conflicts: number
  conflictStreak: number
  /** Set while the ticket sits in ready because a merge loop stopped (#st-build-stop-ready). */
  loopStop?: string
  /** The cited cards as the last plan saw them (#st-ticket-watch). Unset before any plan
   *  recorded them, and then nothing watches the ticket. */
  cites?: Record<string, CardPrint>
  /** The cards this ticket's builds proposed, as the last green build saw them
   *  (#st-build-missing-decision). */
  proposals?: Record<string, CardPrint>
  /** The last change to those proposals that filed a follow-up, in words. */
  decisionChanged?: string
}

export type RunState = {
  tier?: 'feature'
  /** The `werk run` process that holds this run, until it ends. It may have died without
   *  ending, so a reader checks it is alive. */
  pid?: number
  /** Per gate, the last waiting and the last passed run tree. */
  gates: Partial<Record<Gate, { waiting?: string; passed?: string; reason?: string }>>
  /** The last cards-cited result after a map change, if one was recorded. */
  cited?: { ok: boolean; detail: string }
}

/** One card per planned subtree (#vi-board-plan). A later plan of the subtree takes the same
 *  card (#st-plan-extend); a run with tickets from before plans were recorded gets one too. */
export type Plan = {
  run: string
  /** True from plan.started to plan.ended. Drives the pulse. */
  live: boolean
  pid?: number
  /** The process group of a build the map's Build button started, until it ends. It may have
   *  died without ending, so a reader checks it is alive (#werk-board-build-subtree). */
  buildPid?: number
  startedAt?: string
  endedAt?: string
  step?: PlanStep
  /** The agent logs of the last plan, one per step that has one, in step order. */
  logs: Array<{ step: PlanStep; path: string }>
  result?: PlanEnd
  /** The failed step of an agent error. */
  failedStep?: PlanStep
  detail?: string
  planned: string[]
  archived: string[]
  state: PlanState
  /** The plan's tickets, archived ones included, in id order. */
  tickets: string[]
}

export type Board = {
  tickets: Map<string, Ticket>
  runs: Map<string, RunState>
  plans: Map<string, Plan>
  /** The project's target repository (#st-build-target), unset until `werk target` sets it. */
  target?: string
  seq: number
}

export function readBoard(path = paths.board): BoardEvent[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line) as BoardEvent
      } catch (err) {
        throw new Error(`${path}:${i + 1} is not valid JSON: ${(err as Error).message}`)
      }
    })
}

export function appendBoard<T extends BoardEventType>(
  type: T,
  payload: BoardEventMap[T],
  opts: { actor?: 'you' | 'agent'; path?: string; at?: string } = {},
): BoardEvent<T> {
  const path = opts.path ?? paths.board
  mkdirSync(dirname(path), { recursive: true })
  const prev = readBoard(path)
  const event: BoardEvent<T> = {
    seq: prev.length === 0 ? 1 : prev[prev.length - 1].seq + 1,
    at: opts.at ?? new Date().toISOString(),
    actor: opts.actor ?? 'agent',
    type,
    payload,
  }
  appendFileSync(path, JSON.stringify(event) + '\n')
  return event
}

/** `after` sees the tickets after each event, so a measure over time (#ms-col-time) follows
 *  the same column rules as the board. */
export function foldBoard(events: BoardEvent[], after?: (e: BoardEvent, tickets: ReadonlyMap<string, Ticket>) => void): Board {
  const tickets = new Map<string, Ticket>()
  const runs = new Map<string, RunState>()
  const runOf = (run: string) => runs.get(run) ?? runs.set(run, { gates: {} }).get(run)!
  const plans = new Map<string, Plan>()
  const planOf = (run: string) =>
    plans.get(run) ?? plans.set(run, { run, live: false, logs: [], planned: [], archived: [], state: 'done', tickets: [] }).get(run)!
  let next = 0
  let seq = 0
  let target: string | undefined
  for (const e of events) {
    seq = e.seq
    switch (e.type) {
      case 'ticket.planned': {
        const p = e.payload as BoardEventMap['ticket.planned']
        tickets.set(p.id, {
          ...p,
          column: p.blockedBy.length > 0 ? 'blocked' : 'ready',
          since: e.at,
          order: next++,
          archived: false,
          live: false,
          passes: 0,
          freePasses: 0,
          spentBefore: 0,
          openBlockers: [],
          heldOutRed: false,
          heldOutFailed: [],
          heldOutNotRun: [],
          conflicts: 0,
          conflictStreak: 0,
        })
        break
      }
      case 'ticket.moved': {
        const p = e.payload as BoardEventMap['ticket.moved']
        const t = tickets.get(p.id)
        if (!t) break
        if (t.column !== p.to) t.since = e.at
        // #st-build-stuck-retry: leaving a stuck stop for ready or building starts a new budget.
        if (t.column === 'blocked' && t.heldBy === 'stuck' && (p.to === 'ready' || p.to === 'building')) t.spentBefore = t.passes - t.conflicts - t.freePasses
        t.column = p.to
        if (p.to === 'blocked' && p.check) t.heldBy = p.check
        else if (p.to === 'ready') t.heldBy = undefined
        t.loopStop = p.to === 'ready' ? p.loopStop : undefined
        if (p.reason) t.reason = p.reason
        // A reason says why a ticket sits where it is. Entering building without one starts
        // a new attempt, so an older reason (a refused build, say) no longer applies.
        else if (p.to === 'building') t.reason = undefined
        if (p.to !== 'building') {
          t.live = false
          t.liveSince = undefined
          t.pid = undefined
          t.pidGroup = undefined
        }
        break
      }
      case 'ticket.reordered': {
        const p = e.payload as BoardEventMap['ticket.reordered']
        p.ids.forEach((id, i) => {
          const t = tickets.get(id)
          if (t) t.order = i
        })
        break
      }
      case 'ticket.archived':
      case 'ticket.restored': {
        const p = e.payload as BoardEventMap['ticket.archived']
        const t = tickets.get(p.id)
        if (!t) break
        // #vi-board-state-archive-once: an archive of an archived ticket changes nothing, and a
        // restore of a ticket that is not archived changes nothing.
        if (t.archived === (e.type === 'ticket.archived')) break
        t.archived = e.type === 'ticket.archived'
        if (p.reason) t.reason = p.reason
        break
      }
      case 'ticket.revised': {
        const p = e.payload as BoardEventMap['ticket.revised']
        const t = tickets.get(p.id)
        if (!t) break
        t.title = p.title
        t.blockedBy = p.blockedBy
        if (p.steps) t.steps = p.steps
        // The column follows the new blockers the way a planned ticket's does. A ticket a
        // failed set check holds stays held.
        const was = t.column
        if (t.column === 'ready' && p.blockedBy.length > 0) t.column = 'blocked'
        else if (t.column === 'blocked' && !t.heldBy && p.blockedBy.length === 0) t.column = 'ready'
        if (t.column !== was) t.since = e.at
        break
      }
      case 'ticket.cites': {
        const p = e.payload as BoardEventMap['ticket.cites']
        const t = tickets.get(p.id)
        if (!t) break
        t.cites = p.cards
        if (t.heldBy === CITED_CHANGED) {
          t.heldBy = undefined
          t.reason = undefined
          const was = t.column
          t.column = t.blockedBy.length > 0 ? 'blocked' : 'ready'
          if (t.column !== was) t.since = e.at
        }
        break
      }
      case 'ticket.proposals': {
        const p = e.payload as BoardEventMap['ticket.proposals']
        const t = tickets.get(p.id)
        if (t) t.proposals = p.cards
        break
      }
      case 'ticket.decision-changed': {
        const p = e.payload as BoardEventMap['ticket.decision-changed']
        const t = tickets.get(p.id)
        if (t) t.decisionChanged = p.reason
        break
      }
      case 'run.cited': {
        const p = e.payload as BoardEventMap['run.cited']
        runOf(p.run).cited = { ok: p.ok, detail: p.detail }
        break
      }
      case 'ticket.build.started': {
        const p = e.payload as BoardEventMap['ticket.build.started']
        const t = tickets.get(p.id)
        if (!t) break
        t.live = true
        t.liveSince = e.at
        t.loopRun = p.loopRun
        t.log = p.log
        t.pid = p.pid
        t.pidGroup = p.pid === undefined ? undefined : !!p.group
        break
      }
      case 'ticket.pass': {
        const p = e.payload as BoardEventMap['ticket.pass']
        const t = tickets.get(p.id)
        if (!t) break
        t.passes += 1
        t.freePasses += (p.free ? 1 : 0) + (p.freed ? 1 : 0)
        break
      }
      case 'ticket.build.ended': {
        const p = e.payload as BoardEventMap['ticket.build.ended']
        const t = tickets.get(p.id)
        if (!t) break
        t.live = false
        t.liveSince = undefined
        t.lastEnd = p.result
        // #st-build-died: the pass that died wrote no ticket.pass, and it counts against the cap.
        if (p.result === 'died') t.passes += 1
        t.pid = undefined
        t.pidGroup = undefined
        break
      }
      case 'ticket.merge': {
        const p = e.payload as BoardEventMap['ticket.merge']
        const t = tickets.get(p.id)
        if (!t) break
        t.lastMerge = p
        if (p.conflict) {
          t.conflicts += 1
          t.conflictStreak += 1
        } else t.conflictStreak = 0
        break
      }
      case 'run.tier': {
        const p = e.payload as BoardEventMap['run.tier']
        runOf(p.run).tier = p.tier
        break
      }
      case 'run.started': {
        const p = e.payload as BoardEventMap['run.started']
        runOf(p.run).pid = p.pid
        break
      }
      case 'run.ended': {
        runOf((e.payload as BoardEventMap['run.ended']).run).pid = undefined
        break
      }
      case 'plan.started': {
        const p = e.payload as BoardEventMap['plan.started']
        // A new plan of the subtree replaces what the last one showed, not its tickets.
        Object.assign(planOf(p.run), {
          live: true,
          pid: p.pid,
          startedAt: e.at,
          endedAt: undefined,
          step: undefined,
          logs: [],
          result: undefined,
          failedStep: undefined,
          detail: undefined,
          planned: [],
          archived: [],
        })
        break
      }
      case 'build.started': {
        const p = e.payload as BoardEventMap['build.started']
        planOf(p.run).buildPid = p.pid
        break
      }
      case 'build.ended': {
        planOf((e.payload as BoardEventMap['build.ended']).run).buildPid = undefined
        break
      }
      case 'plan.step': {
        const p = e.payload as BoardEventMap['plan.step']
        const pl = planOf(p.run)
        pl.step = p.step
        if (p.log) pl.logs = [...pl.logs.filter((l) => l.step !== p.step), { step: p.step, path: p.log }]
        break
      }
      case 'plan.ended': {
        const p = e.payload as BoardEventMap['plan.ended']
        const pl = planOf(p.run)
        pl.live = false
        pl.pid = undefined
        pl.endedAt = e.at
        pl.result = p.result
        pl.failedStep = p.step
        pl.detail = p.detail
        pl.planned = p.planned ?? []
        pl.archived = p.archived ?? []
        break
      }
      case 'project.target': {
        target = (e.payload as BoardEventMap['project.target']).repo
        break
      }
      case 'gate.waiting':
      case 'gate.passed': {
        const p = e.payload as BoardEventMap['gate.waiting']
        const r = runOf(p.run)
        const g = (r.gates[p.gate] ??= {})
        if (e.type === 'gate.waiting') {
          g.waiting = p.tip
          g.reason = p.reason
        } else g.passed = p.tip
        break
      }
      case 'ticket.heldout': {
        const p = e.payload as BoardEventMap['ticket.heldout']
        const t = tickets.get(p.id)
        if (!t) break
        t.heldOutFailed = p.failed ?? []
        t.heldOutNotRun = p.binderErrors ?? []
        // #st-heldout-notrun: a step the binder could not run is not red. A red result that
        // names neither kind stays red: nothing says the steps ran.
        t.heldOutRed = !p.green && (t.heldOutFailed.length > 0 || t.heldOutNotRun.length === 0)
        // #st-heldout-followup-per-ticket: one follow-up per source ticket of the red steps. An
        // older event names one follow-up only.
        t.followUps = p.followUps ?? (p.followUp ? [p.followUp] : [])
        t.followUp = t.followUps[0]
        break
      }
    }
    after?.(e, tickets)
  }
  for (const t of tickets.values()) {
    t.openBlockers = t.blockedBy.filter((b) => tickets.get(b)?.column !== 'done')
    planOf(t.run).tickets.push(t.id)
  }
  for (const pl of plans.values()) {
    pl.tickets.sort()
    pl.state = planState(pl, pl.tickets.map((id) => tickets.get(id)!))
  }
  return { tickets, runs, plans, target, seq }
}

/** The color of a plan card, from the plan and its tickets (#vi-board-plan). */
export function planState(pl: Pick<Plan, 'live' | 'result'>, tickets: Array<Pick<Ticket, 'column' | 'archived'>>): PlanState {
  if (pl.live) return 'creating'
  if (pl.result && pl.result !== 'ok') return 'stopped'
  return tickets.some((t) => !t.archived && t.column !== 'done') ? 'building' : 'done'
}

/** Tickets per column, archived ones left out, each column in its own order. */
export function columns(board: Board): Record<Column, Ticket[]> {
  const out = Object.fromEntries(COLUMNS.map((c) => [c, [] as Ticket[]])) as Record<Column, Ticket[]>
  for (const t of board.tickets.values()) if (!t.archived) out[t.column].push(t)
  for (const c of COLUMNS) out[c].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return out
}

/**
 * The manual moves a person may make (#werk-board-control): the trigger, ready into building,
 * is the only one. A build is never stopped in place: archiving its ticket ends it. Every other
 * column change belongs to an agent or to the merge loop, never to a drag.
 */
export function manualMove(t: Ticket, to: Column): { ok: true } | { ok: false; why: string } {
  if (t.archived) return { ok: false, why: 'an archived ticket does not move' }
  if (t.column === 'ready' && to === 'building') {
    return t.openBlockers.length === 0
      ? { ok: true }
      : { ok: false, why: `blocked by ${t.openBlockers.join(', ')}` }
  }
  if (t.column === 'building' && to === 'ready') return { ok: false, why: 'a build is not stopped in place: archive its ticket to end it' }
  return { ok: false, why: `${t.column} → ${to} is not a person's move` }
}

/** The pid of the `werk run` that holds this run, when that process is still alive. */
export function runHolder(b: Board, run: string, alive: (pid: number) => boolean): number | undefined {
  const pid = b.runs.get(run)?.pid
  return pid !== undefined && alive(pid) ? pid : undefined
}

/** The process group of the subtree's Build-button build, while it is alive. */
export function buildHolder(b: Board, run: string, alive: (pid: number) => boolean): number | undefined {
  const pid = b.plans.get(run)?.buildPid
  return pid !== undefined && alive(pid) ? pid : undefined
}

/**
 * The live process of a run in progress on the subtree `run`, or undefined (#st-run-start-guard).
 * A run is in progress while a process that drives it is alive: the Build button's process
 * group, a `werk plan`, or a `werk run`. `exempt` names processes that are the caller itself or
 * its parent, so a plan or a merge loop started by the Build button does not refuse itself.
 */
export function runInProgress(b: Board, run: string, alive: (pid: number) => boolean, exempt: number[] = []): number | undefined {
  const plan = b.plans.get(run)
  const pids = [plan?.buildPid, plan?.live ? plan.pid : undefined, b.runs.get(run)?.pid]
  return pids.find((pid): pid is number => pid !== undefined && !exempt.includes(pid) && alive(pid))
}

/**
 * Why a run on `run` may not start now, because a run is in progress on it or on one of its
 * `ancestors` (#st-run-start-guard). It names the blocking run, whose plan card is on the board.
 * Every start checks it: a plan, a run, a resume, a restart, and the Build button. A run on a
 * descendant does not block.
 */
export function startRefusal(
  b: Board,
  run: string,
  ancestors: string[],
  alive: (pid: number) => boolean,
  exempt: number[] = [],
): { run: string; why: string } | undefined {
  for (const s of [run, ...ancestors]) {
    if (runInProgress(b, s, alive, exempt) !== undefined) {
      return { run: s, why: `a run is in progress on #${s}: see its plan card on the board` }
    }
  }
  return undefined
}

/** The subtree's unfinished work (#werk-board-restart): its tickets that are ready, blocked,
 *  building or merging, archived ones left out. A done ticket is not unfinished. */
export function unfinishedWork(b: Board, run: string): Ticket[] {
  return [...b.tickets.values()].filter((t) => t.run === run && !t.archived && t.column !== 'done').sort((x, y) => x.id.localeCompare(y.id))
}

/**
 * Why the map's Build button may not start a build of `run` now, or undefined when it may
 * (#werk-board-build-subtree). `blockers` are the open and proto cards in the plan's scope,
 * undefined when the map has no such card. A subtree with unfinished work offers resume and
 * restart instead (#werk-board-restart).
 */
export function buildRefusal(
  b: Board,
  run: string,
  blockers: string[] | undefined,
  alive: (pid: number) => boolean,
  ancestors: string[] = [],
): string | undefined {
  if (blockers === undefined) return `no card "${run}" in the map`
  if (blockers.length) return `open or proto cards in the scope: ${blockers.join(', ')}`
  if (!b.target) return 'no target repository is set'
  const busy = startRefusal(b, run, ancestors, alive)
  if (busy) return busy.why
  if (unfinishedWork(b, run).length) return `#${run} has unfinished work: resume it, or restart it`
  return undefined
}

/** Why a resume of `run` may not start now (#werk-board-restart): it needs unfinished work. */
export function resumeRefusal(b: Board, run: string, alive: (pid: number) => boolean, ancestors: string[] = []): string | undefined {
  if (!b.target) return 'no target repository is set'
  const busy = startRefusal(b, run, ancestors, alive)
  if (busy) return busy.why
  if (!unfinishedWork(b, run).length) return `#${run} has no unfinished work to resume`
  return undefined
}

/** Why a restart of `run` may not start now. A restart plans again, so the plan scope must be
 *  decided, like the Build button's. */
export function restartRefusal(
  b: Board,
  run: string,
  blockers: string[] | undefined,
  alive: (pid: number) => boolean,
  ancestors: string[] = [],
): string | undefined {
  if (blockers === undefined) return `no card "${run}" in the map`
  if (blockers.length) return `open or proto cards in the scope: ${blockers.join(', ')}`
  if (!b.target) return 'no target repository is set'
  return startRefusal(b, run, ancestors, alive)?.why
}

/** What a restart of `run` ends (#werk-board-restart): it cancels each building ticket's build
 *  and keeps its branch, archives every unfinished ticket, and keeps the done ones. */
export function restartPlan(b: Board, run: string): { cancel: Ticket[]; archive: Ticket[]; keep: Ticket[] } {
  const archive = unfinishedWork(b, run)
  const keep = [...b.tickets.values()].filter((t) => t.run === run && !t.archived && t.column === 'done').sort((x, y) => x.id.localeCompare(y.id))
  return { cancel: archive.filter((t) => t.column === 'building'), archive, keep }
}

/** The lines that say what a restart ends, for its confirmation. */
export function restartLines(run: string, p: ReturnType<typeof restartPlan>): string[] {
  const ids = (ts: Ticket[]) => ts.map((t) => t.id).join(', ')
  return [
    `a restart of #${run} ends the unfinished work:`,
    ...(p.cancel.length ? [`  cancel the build of ${ids(p.cancel)}, and keep each branch`] : []),
    p.archive.length ? `  archive ${ids(p.archive)} (each one can be restored)` : '  nothing to archive',
    ...(p.keep.length ? [`  keep ${ids(p.keep)}, which are done`] : []),
    '  then plan the subtree again from its current spec, and run it',
  ]
}

/**
 * Carry out the ending half of a restart: signal each cancelled build that still has a live
 * process, then archive each unfinished ticket with the reason. `stop` ends one build and says
 * whether it signalled a process. The branches stay.
 */
export function endUnfinishedWork(
  b: Board,
  run: string,
  opts: { path?: string; actor?: 'you' | 'agent'; stop: (t: Ticket) => boolean },
): { cancelled: string[]; archived: string[] } {
  const p = restartPlan(b, run)
  const cancelled = p.cancel.filter((t) => opts.stop(t)).map((t) => t.id)
  for (const t of p.archive) appendBoard('ticket.archived', { id: t.id, reason: `a restart of #${run} ended the unfinished work`, restart: run }, { actor: opts.actor, path: opts.path })
  return { cancelled, archived: p.archive.map((t) => t.id) }
}

/** Signal the build process a ticket's live session names, when it is still alive: its group
 *  when the build leads one. True when a signal went out. */
export function signalBuild(t: Ticket, alive: (pid: number) => boolean): boolean {
  if (!t.live || !t.pid || !alive(t.pid)) return false
  try {
    process.kill(t.pidGroup ? -t.pid : t.pid, 'SIGTERM')
    return true
  } catch {
    return false
  }
}

/** Archive is offered on a ticket that is ready, blocked or building (#werk-board-control).
 *  Archiving a building ticket ends its build and keeps its branch. A merging or done ticket
 *  is not archived. */
export function canArchive(t: Ticket): boolean {
  return !t.archived && (t.column === 'ready' || t.column === 'blocked' || t.column === 'building')
}

/**
 * An agent's move between blocked and ready (#werk-board-control). The agent always states
 * the blocking reason or the resolution, so a move without one is refused.
 */
export function agentMove(t: Ticket, to: Column, reason: string | undefined): { ok: true } | { ok: false; why: string } {
  if (t.archived) return { ok: false, why: 'an archived ticket does not move; restore it first' }
  if (to !== 'blocked' && to !== 'ready') return { ok: false, why: `an agent moves a ticket only to blocked or ready, not ${to}` }
  if (t.column !== 'blocked' && t.column !== 'ready') {
    return { ok: false, why: `${t.id} is in ${t.column}; only the merge loop moves it from there` }
  }
  if (t.column === to) return { ok: false, why: `${t.id} is already in ${to}` }
  // #st-ticket-watch-marked-blocked: only a plan that keeps the ticket clears a cited-card mark.
  if (to === 'ready' && t.heldBy === CITED_CHANGED) return { ok: false, why: `${t.id} is marked: a cited card changed. Only a plan that keeps the ticket clears the mark` }
  if (!reason?.trim()) return { ok: false, why: 'a move between blocked and ready needs --reason' }
  return { ok: true }
}

/** The new order of the ready column must name every ready ticket exactly once. */
export function checkReorder(board: Board, ids: string[]): { ok: true } | { ok: false; why: string } {
  const ready = columns(board).ready.map((t) => t.id)
  if (ids.length !== ready.length || new Set(ids).size !== ids.length || !ids.every((id) => ready.includes(id))) {
    return { ok: false, why: `the new order must list exactly the ready tickets: ${ready.join(', ') || '(none)'}` }
  }
  return { ok: true }
}
