/**
 * The pipeline measures that the Flow panels draw — #vi-flow-ms. Pure: the caller reads the
 * pipeline log and the ticket sizes, this folds them into one series per panel. The bands and
 * the outlier colours are the panel's own job, so a change to the band rule needs no change here.
 */
import { failReport, THRESHOLDS, type Fail, type GateRow } from './fails.ts'
import { CITED_CHANGED, type BoardEvent, type BoardEventMap } from './board.ts'
import { STUCK_HOLD } from './run-state.ts'
import { foldPasses, type BuildStepEnded, type PipelineEvent, type PlanTurnEnded } from './pipeline.ts'
import { addTokens, ZERO_TOKENS, type Tokens } from './cost.ts'
import { columnTimes, type ColumnTime } from './col-time.ts'
import { escapes, followUps, reworkedCards, type Escape, type FollowUp, type ReworkedCard } from './outcomes.ts'
import type { Event } from './types.ts'

/**
 * The stage a build session's cost belongs to. A session name carries its pass number
 * (`review-tests-3`), and a panel line is one stage over every pass, so the number goes.
 */
export function stageOf(name: string): string {
  const base = name.replace(/-\d+$/, '')
  return base === 'pass' ? 'build' : base === 'grade' ? 'grader' : base
}

/**
 * One finished build of one ticket (#vi-flow-ms-effort). `ms` is the time its passes ran, and
 * `tokens` what its sessions spent, so the panel can switch unit (#vi-flow-ms-effort-unit).
 */
export type EffortPoint = { ticket: string; build: string; at: string; costUsd: number; tokens: Tokens; ms: number; passes: number; size: number; sized: boolean; effort: number }

/**
 * The cost of one stage in one hour, UTC, as `2026-10-21T14` (#vi-flow-ms-stage), in each unit
 * the panel can switch to (#vi-flow-ms-stage-unit). The panel sums hours into the days or weeks
 * its period draws. `items` are what a point opens.
 */
export type StageHour = { stage: string; hour: string; costUsd: number; tokens: Tokens; ms: number; items: string[] }

/** The tokens of an older session event that did not record them, read from its transcript. */
/**
 * One costed event of the project's own spend (#ms-cost-total): a plan turn, or a pipeline session.
 * A build's own rollup event is left out, because it repeats its sessions. The Measure tab adds
 * these up by role, chat, ticket, spec and card (#ms-cost-rollup, #vi-flow-ms-cost).
 */
export type Spend = {
  at: string
  /** 'chat' is a chat-pane turn, 'terminal' a terminal turn that wrote to the map, 'pipeline' a build session. */
  kind: 'chat' | 'terminal' | 'pipeline'
  /** The role of a pipeline session, or the kind of a plan turn. */
  role: string
  /** The conversation or session id of a plan turn. */
  chat?: string
  card?: string
  ticket?: string
  /** The plan run the ticket was planned in, which is its spec; a spec or ticket writer names its run. */
  spec?: string
  costUsd: number
  tokens: Tokens
  ms: number
}

export type SessionTokens = (file: string) => Tokens | undefined

export type StopKind = 'gate' | 'check' | 'stuck' | 'cited-changed' | 'blocked' | 'loop-stopped' | 'main-red' | 'main-conflict' | 'retry-cap' | 'restart'

/**
 * One stop of the build: work that cannot go on until a person acts (#vi-flow-ms-waits). `end` is
 * the event that moved the work on, or null while the stop lasts. The reason is the text the log
 * holds for the stop, shown in the drill-down only.
 */
export type Stop = { kind: StopKind; item: string; at: string; end: string | null; reason: string }

type Move = BoardEventMap['ticket.moved']

/**
 * The kind of stop a ticket move records. It is read from the move's structured fields: the
 * check that holds a blocked ticket, and how the merge loop ended. A move written before those
 * fields existed has only its reason, so the start of the reason decides for it.
 */
export function stopKind(p: Move): StopKind | null {
  const reason = p.reason ?? ''
  if (p.to === 'blocked') {
    const check = p.check ?? (/^stuck:/.test(reason) ? STUCK_HOLD : /^(set|own) check .* failed/.test(reason) ? 'check' : undefined)
    return check === STUCK_HOLD ? 'stuck' : check === CITED_CHANGED ? 'cited-changed' : check ? 'check' : 'blocked'
  }
  if (p.to === 'ready' && (p.loopStop || reason.startsWith('the merge loop stopped'))) return 'loop-stopped'
  return null
}

/**
 * The stops in the board log and the pipeline log. A ticket's stop ends at its next move. A red
 * merge ends at the ticket's first move that does not send it back to building. A gate stop ends
 * when the gate passes. A build that reached its retry cap ends at the ticket's next build.
 */
export function stops(board: BoardEvent[], pipeline: PipelineEvent[]): Stop[] {
  const out: Stop[] = []
  const moves = new Map<string, { at: string; to: string }[]>() // ticket -> its moves, in order
  for (const e of board) {
    if (e.type !== 'ticket.moved' && e.type !== 'ticket.archived') continue
    const p = e.payload as { id: string; to?: string }
    moves.set(p.id, [...(moves.get(p.id) ?? []), { at: e.at, to: p.to ?? 'archived' }])
  }
  const next = (list: { at: string }[] | undefined, at: string) => list?.find((m) => m.at > at)?.at ?? null
  for (const e of board) {
    if (e.type === 'ticket.moved') {
      const p = e.payload as Move
      const kind = stopKind(p)
      if (kind) out.push({ kind, item: p.id, at: e.at, end: next(moves.get(p.id), e.at), reason: p.reason ?? '' })
    } else if (e.type === 'ticket.merge') {
      const p = e.payload as BoardEventMap['ticket.merge']
      if (p.green) continue
      const end = moves.get(p.id)?.find((m) => m.at > e.at && m.to !== 'building')?.at ?? null
      out.push({ kind: p.conflict ? 'main-conflict' : 'main-red', item: p.id, at: e.at, end, reason: p.cmd ? `${p.cmd} (exit ${p.code})` : (p.detail ?? '') })
    } else if (e.type === 'ticket.archived') {
      // #ms-outcome-interv: one stop per restart, not per ticket it ended. It lasts until the
      // subtree's next plan starts.
      const p = e.payload as BoardEventMap['ticket.archived']
      if (!p.restart || out.some((s) => s.kind === 'restart' && s.item === p.restart && s.at === e.at)) continue
      const end = board.find((x) => x.type === 'plan.started' && x.at >= e.at && (x.payload as { run: string }).run === p.restart)?.at ?? null
      out.push({ kind: 'restart', item: p.restart, at: e.at, end, reason: p.reason ?? '' })
    } else if (e.type === 'gate.waiting') {
      const p = e.payload as { run: string; gate: string; tip: string; reason: string }
      const passed = board.find((x) => x.type === 'gate.passed' && x.at > e.at && (x.payload as { run: string; gate: string; tip: string }).run === p.run && (x.payload as { gate: string }).gate === p.gate)
      out.push({ kind: 'gate', item: `${p.run} ${p.gate}`, at: e.at, end: passed?.at ?? null, reason: p.reason })
    }
  }
  const starts = new Map<string, { at: string }[]>() // ticket -> when its builds started
  for (const e of pipeline) {
    const p = e.payload as { step: string; ticket: string }
    if (e.type === 'step.started' && p.step === 'build') starts.set(p.ticket, [...(starts.get(p.ticket) ?? []), { at: e.at }])
  }
  for (const e of pipeline) {
    if (e.type !== 'step.ended') continue
    const p = e.payload as { step: string; result?: string; ticket: string }
    if (p.step === 'build' && p.result === 'cap') out.push({ kind: 'retry-cap', item: p.ticket, at: e.at, end: next(starts.get(p.ticket), e.at), reason: 'the build reached its retry cap' })
  }
  return out.sort((a, b) => a.at.localeCompare(b.at))
}

export type Measures = {
  /** Where the build stopped for a person (#vi-flow-ms-waits). */
  stops: Stop[]
  effort: EffortPoint[]
  stages: StageHour[]
  /** Fails per gate, split by cause (#vi-flow-ms-checks, #vi-flow-ms-judge). */
  gates: GateRow[]
  /** Every fail, so a bar segment opens the passes behind it. */
  fails: Fail[]
  /** The false-finding share and minimum sample of #ms-fail, so the judge panel draws the same rule. */
  falseShare: number
  falseMinFails: number
  signals: string[]
  /** Each ticket's time in each board column, from the board log (#ms-col-time). */
  columns: ColumnTime[]
  /** The outcomes that fold over the board log and the decision log (#ms-outcome). */
  followUps: FollowUp[]
  escapes: Escape[]
  reworkedCards: ReworkedCard[]
  spend: Spend[]
}

/**
 * Effort per build: the cost of every pass, over the ticket's size in stories (#lp-trend-size).
 * A ticket with no story, or with no known size, counts as size 1 and says so.
 */
export function measures(
  events: PipelineEvent[],
  sizeOf: (ticket: string) => number | undefined = () => undefined,
  board: BoardEvent[] = [],
  sessionTokens: SessionTokens = () => undefined,
  decisions: Event[] = [],
): Measures {
  const passes = foldPasses(events)
  const builds = new Map<string, typeof passes>()
  for (const p of passes) builds.set(p.loopRun, [...(builds.get(p.loopRun) ?? []), p])
  const tokensOf = (p: BuildStepEnded) => p.tokens ?? (p.file ? sessionTokens(p.file) : undefined) ?? ZERO_TOKENS
  const buildTokens = new Map<string, Tokens>()
  for (const e of events) {
    const p = e.payload as BuildStepEnded
    if (e.type === 'step.ended' && p.step === 'session') buildTokens.set(p.build, addTokens(buildTokens.get(p.build) ?? ZERO_TOKENS, tokensOf(p)))
  }
  const effort: EffortPoint[] = []
  for (const [build, list] of builds) {
    const last = list.reduce((a, b) => (b.pass > a.pass ? b : a))
    if (!last.green) continue
    const costUsd = list.reduce((n, p) => n + p.costUsd, 0)
    const ms = list.reduce((n, p) => n + p.ms, 0)
    const known = sizeOf(last.ticket)
    const size = known && known > 0 ? known : 1
    const at = list.reduce((a, p) => (p.at > a ? p.at : a), '')
    const tokens = buildTokens.get(build) ?? ZERO_TOKENS
    effort.push({ ticket: last.ticket, build, at, costUsd, tokens, ms, passes: list.length, size, sized: !!known, effort: costUsd / size })
  }
  effort.sort((a, b) => a.at.localeCompare(b.at))

  // A plan turn is the plan stage. A build session is the stage of its role: the builder, the
  // grader, each reviewer.
  const cells = new Map<string, StageHour>()
  for (const e of events) {
    if (e.type !== 'step.ended') continue
    const p = e.payload as BuildStepEnded | PlanTurnEnded
    let stage: string, item: string, tokens: Tokens
    if (p.step === 'turn') (stage = 'plan'), (item = (p as PlanTurnEnded).card ?? (p as PlanTurnEnded).session), (tokens = (p as PlanTurnEnded).tokens)
    else if (p.step === 'session') (stage = stageOf((p as BuildStepEnded).name ?? 'session')), (item = (p as BuildStepEnded).ticket), (tokens = tokensOf(p as BuildStepEnded))
    else continue
    const hour = new Date(e.at).toISOString().slice(0, 13)
    const key = `${stage}\u0000${hour}`
    const c = cells.get(key) ?? { stage, hour, costUsd: 0, tokens: ZERO_TOKENS, ms: 0, items: [] }
    c.costUsd += p.costUsd ?? 0
    c.tokens = addTokens(c.tokens, tokens)
    c.ms += p.ms ?? 0
    if (!c.items.includes(item)) c.items.push(item)
    cells.set(key, c)
  }
  const stages = [...cells.values()].sort((a, b) => a.hour.localeCompare(b.hour) || a.stage.localeCompare(b.stage))

  const specOf = new Map<string, string>()
  for (const e of board) if (e.type === 'ticket.planned') specOf.set((e.payload as BoardEventMap['ticket.planned']).id, (e.payload as BoardEventMap['ticket.planned']).run)
  const spend: Spend[] = []
  for (const e of events) {
    if (e.type !== 'step.ended') continue
    const p = e.payload as BuildStepEnded | PlanTurnEnded
    if (p.step === 'turn') {
      const t = p as PlanTurnEnded
      spend.push({ at: e.at, kind: t.card ? 'chat' : 'terminal', role: t.card ? 'plan chat' : 'terminal turn', chat: t.session, card: t.card ?? undefined, costUsd: t.costUsd ?? 0, tokens: t.tokens ?? ZERO_TOKENS, ms: t.ms ?? 0 })
    } else if (p.step === 'session') {
      const b = p as BuildStepEnded
      const role = stageOf(b.name ?? 'session')
      const spec = specOf.get(b.ticket) ?? (role === 'spec-writer' || role === 'ticket-writer' ? b.ticket : undefined)
      spend.push({ at: e.at, kind: 'pipeline', role, ticket: b.ticket, spec, costUsd: b.costUsd ?? 0, tokens: tokensOf(b), ms: b.ms ?? 0 })
    }
  }

  const report = failReport(passes)
  return { stops: stops(board, events), effort, stages, gates: report.byGate, fails: report.fails, falseShare: THRESHOLDS.falseShare, falseMinFails: THRESHOLDS.falseMinFails, signals: report.signals,
    columns: columnTimes(board),
    followUps: followUps(board),
    escapes: escapes(board),
    reworkedCards: reworkedCards(board, decisions),
    spend,
  }
}
