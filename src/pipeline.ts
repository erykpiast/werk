/**
 * The pipeline log — #ms-store. One append-only file, .werk/pipeline.jsonl, in the
 * {seq, at, actor, type, payload} shape of the decision log and the board log. Every step of
 * a build, and every plan, writes a started and an ended event; every measure of a step is a
 * fold over these events. Large detail — agent transcripts, full check output, a plan's copy
 * of what it wrote — stays in files beside it, named by the events (#ms-store-files,
 * #ms-store-plancopy). Git tracks this file (#ms-store-git).
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { GateDetail, NamedCause } from './build-prompt.ts'
import type { ScopeEntry, ScopeSize } from './plan-record.ts'
import { paths } from './project.ts'

/** The steps of the builder loop. A pass holds one builder session, its checks, and the
 *  sessions of the grader and the reviewers. A merge is one attempt of the merge loop on the
 *  build's ticket, with its checks under it. A step with no pass is not the builder's: a merge
 *  check, or a held-out session under the run's held-out directory. */
export type StepKind = 'build' | 'pass' | 'session' | 'check' | 'merge'

/** Where a step sits: the build it belongs to, and the pass inside it. */
export type StepRef = { build: string; ticket: string; step: StepKind; pass?: number; name?: string }

/** What a pass ended with: the facts the fail report reads (#ms-fail), and each gate's own
 *  record (the grader's scores, the review's findings). */
export type PassEnd = {
  green: boolean
  failure?: string
  gate?: GateDetail
  /** A record written before a flaky check stopped failing the pass: the red check passed on
   *  its rerun, and the pass stayed red. */
  flaky?: boolean
  /** Each check that was red, then green on its rerun; the pass went on (#ms-fail-cause). */
  flakyChecks?: string[]
  infra?: string
  causeOfLast?: { cause: NamedCause; why: string }
  gateOfLast?: GateDetail
  [record: string]: unknown
}

/** The end of one step of a build. */
export type BuildStepEnded = StepRef & {
  ms: number
  /** The step's own result: green or red for a pass, ok for a check, the end of a build. */
  result: string
  costUsd?: number
  /** A session's tokens by kind. An older session event has none; its transcript does. */
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  turns?: number
  /** The file beside the log with this step's full detail, relative to the project. */
  file?: string
  code?: number
  /** A check run again on the same commit, to tell a flaky check (#ms-fail-cause). */
  rerun?: boolean
  error?: string
  pass_end?: PassEnd
  /** The model responses the cost covers, and how many subagents and forks it counts (#ms-cost-tree). */
  responses?: number
  subagents?: number
  /** A session no step event was written for, found in its transcripts later: its id, and a flag. */
  session?: string
  imported?: boolean
}

/**
 * The end of one plan turn (#ms-store-plan). It holds the turn's facts, not a share of its
 * cost: the rule that turns facts into plan cost per card (#ms-cost-history) is a fold, so
 * a change to the rule needs no rewrite of the log.
 */
export type PlanTurnEnded = {
  stage: 'plan'
  step: 'turn'
  session: string
  /** The prompt's own id in the session. With the session, it names the turn once. */
  turnId: string
  /** The card open on the map in a chat-pane turn. Null for a terminal turn. */
  card: string | null
  /** The cards the turn wrote through the CLI. */
  cardsWritten: string[]
  /** How many of the turn's responses wrote to the map, and how many changed code. */
  mapResponses: number
  codeResponses: number
  responses: number
  /** The subagent responses this event counts. Unset on an event written before parts existed. */
  subagentResponses?: number
  /** A background task can wake a turn after its result. Each wake adds the next part, with
   *  only the responses since the part before (#ms-store-plan). Unset means part 0. */
  part?: number
  ms: number
  costUsd: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  /** Responses from a model with no price, counted as $0. */
  unpriced: number
  /** The date the price table behind costUsd is valid from. */
  prices: string
  /** Written later from a transcript, not when the turn ended. */
  backfilled?: boolean
  result: string
}

/**
 * The start of one plan of a subtree, with the scope it reads (#ms-store-scope). The event's
 * seq names the plan: its end event and its copy carry it.
 */
export type PlanStarted = { stage: 'plan'; step: 'plan'; subtree: string; scope: ScopeEntry[]; size: ScopeSize }

/** The end of one plan. `file` is the directory with the copy of what it wrote, relative to
 *  the project (#ms-store-plancopy). A plan that stopped before its writers has none. */
export type PlanEnded = { stage: 'plan'; step: 'plan'; subtree: string; plan: number; ms: number; result: string; file?: string }

export type PipelineEventMap = {
  'step.started': (StepRef & { cap?: number }) | PlanStarted
  'step.ended': BuildStepEnded | PlanTurnEnded | PlanEnded
}
export type PipelineEventType = keyof PipelineEventMap

/**
 * The cost of a past session, rebuilt from its transcripts (#ms-cost-history-pipeline). It
 * names the session event by the file it wrote. The original event stays in the log; a read
 * folds the correction into it.
 */
export type SessionCorrected = {
  file: string
  costUsd: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }
  responses: number
  subagents: number
}
export type CorrectionEvent = { seq: number; at: string; actor: 'you' | 'agent'; type: 'step.corrected'; payload: SessionCorrected }

export type PipelineEvent<T extends PipelineEventType = PipelineEventType> = {
  seq: number
  at: string
  actor: 'you' | 'agent'
  type: T
  payload: PipelineEventMap[T]
}

/** Every line of the log, corrections included. */
export function readPipelineRaw(path = paths.pipeline): (PipelineEvent | CorrectionEvent)[] {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line) as PipelineEvent | CorrectionEvent
      } catch (err) {
        throw new Error(`${path}:${i + 1} is not valid JSON: ${(err as Error).message}`)
      }
    })
}

/**
 * The log as every fold reads it: each correction is merged into the session event it names,
 * and the latest correction of a session wins. Folds never see a correction event.
 */
export function readPipeline(path = paths.pipeline): PipelineEvent[] {
  const raw = readPipelineRaw(path)
  const fix = new Map<string, SessionCorrected>()
  for (const e of raw) if (e.type === 'step.corrected') fix.set(e.payload.file, e.payload)
  const out: PipelineEvent[] = []
  for (const e of raw) {
    if (e.type === 'step.corrected') continue
    const p = e.payload as BuildStepEnded
    const c = e.type === 'step.ended' && p.step === 'session' && p.file ? fix.get(p.file) : undefined
    out.push(c ? { ...e, payload: { ...p, costUsd: c.costUsd, tokens: c.tokens, responses: c.responses, subagents: c.subagents } } : (e as PipelineEvent))
  }
  return out
}

/** The next seq comes from the last line only, so an append does not parse the whole log. */
function lastSeq(path: string): number {
  if (!existsSync(path)) return 0
  const text = readFileSync(path, 'utf8').trimEnd()
  const last = text.slice(text.lastIndexOf('\n') + 1)
  return last ? (JSON.parse(last) as PipelineEvent).seq : 0
}

export function appendPipeline<T extends PipelineEventType>(type: T, payload: PipelineEventMap[T], opts: { path?: string; at?: string } = {}): PipelineEvent<T> {
  const path = opts.path ?? paths.pipeline
  mkdirSync(dirname(path), { recursive: true })
  const event: PipelineEvent<T> = { seq: lastSeq(path) + 1, at: opts.at ?? new Date().toISOString(), actor: 'agent', type, payload }
  appendFileSync(path, JSON.stringify(event) + '\n')
  return event
}

/**
 * Append many events with one read of the last seq and one write. A backfill appends
 * hundreds of events; one append each would read the log back hundreds of times.
 */
export function appendPipelineMany(
  events: { type: PipelineEventType; payload: PipelineEventMap[PipelineEventType]; at: string }[],
  path = paths.pipeline,
): number {
  if (events.length === 0) return 0
  mkdirSync(dirname(path), { recursive: true })
  let seq = lastSeq(path)
  const text = events
    .map((e) => JSON.stringify({ seq: ++seq, at: e.at, actor: 'agent', type: e.type, payload: e.payload }) + '\n')
    .join('')
  appendFileSync(path, text)
  return events.length
}

/** Append corrections with one read of the last seq and one write. */
export function appendCorrections(list: SessionCorrected[], path = paths.pipeline): number {
  if (list.length === 0) return 0
  mkdirSync(dirname(path), { recursive: true })
  let seq = lastSeq(path)
  const at = new Date().toISOString()
  appendFileSync(path, list.map((payload) => JSON.stringify({ seq: ++seq, at, actor: 'agent', type: 'step.corrected', payload }) + '\n').join(''))
  return list.length
}

/** One pass, folded back from its events: what the fail report and the build tests read. */
export type PassFacts = PassEnd & {
  ticket: string
  loopRun: string
  pass: number
  at: string
  ms: number
  cap?: number
  /** The cost of every session in the pass: the builder, the grader, each reviewer. */
  costUsd: number
}

export function foldPasses(events: PipelineEvent[]): PassFacts[] {
  const caps = new Map<string, number | undefined>()
  const started = new Map<string, string>()
  const cost = new Map<string, number>()
  const passes: PassFacts[] = []
  const key = (p: StepRef) => `${p.build}\u0000${p.pass}`
  for (const e of events) {
    const p = e.payload
    if (e.type === 'step.started') {
      const s = p as StepRef & { cap?: number }
      if (s.step === 'build') caps.set(s.build, s.cap)
      if (s.step === 'pass') started.set(key(s), e.at)
      continue
    }
    if (p.step === 'turn' || p.step === 'plan') continue
    const end = p as BuildStepEnded
    if (end.step === 'session' && end.pass !== undefined) cost.set(key(end), (cost.get(key(end)) ?? 0) + (end.costUsd ?? 0))
    if (end.step !== 'pass' || end.pass === undefined || !end.pass_end) continue
    passes.push({
      ...end.pass_end,
      ticket: end.ticket,
      loopRun: end.build,
      pass: end.pass,
      at: started.get(key(end)) ?? e.at,
      ms: end.ms,
      cap: caps.get(end.build),
      costUsd: cost.get(key(end)) ?? 0,
    })
  }
  return passes
}
