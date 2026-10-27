/**
 * `werk build <ticket-id>`: the builder loop for one ticket. See #st-build-ticket.
 *
 * One ticket, one worktree, fresh passes (#lp-stateless):
 *
 *   1. Implement. A fresh builder agent gets the brief and the last failure, nothing else.
 *   2. Check. The ticket's checks run, one command each, exit code only (#lp-checks).
 *   3. The gates: the grader (#lp-prod-judge), then the quality review (#lp-prod-review).
 *
 * A fail at any step starts a new pass at step 1, with the failure in its brief. The retry cap
 * stops the loop; a pass that ends on a spec gap does not count (#st-build-cap-spec-gap). A session that goes silent is cancelled by the overseer and the next pass is
 * told why (#st-build-silence-act); it counts against the cap.
 *
 * Before any code, the command appends a card obligation to the project's log (#st-build-card).
 * The ticket's state goes to the board (src/board.ts): started, one event per pass, ended, and
 * a move to merging on green. The merge itself belongs to the merge loop (#st-build-run).
 *
 * The base is the tip of the main line, the branch `main`, never a snapshot of a working tree:
 * tickets build from and merge onto the main line, with no integration branch of their own
 * (#st-plan-main, #werk-base-branch). Without that branch the build refuses. The ticket's own
 * branch `werk-build/<loop run>` is kept after the run; its worktree is not.
 *
 * The main line, the worktree and the branch belong to the target repository; the ticket
 * text, the board and the logs to the map's (#st-build-target).
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { appendBoard, foldBoard, readBoard } from './board.ts'
import type { BuildEnd } from './board.ts'
import { append, readEvents } from './log.ts'
import { paths } from './project.ts'
import { decisionTrigger, firstDecision, personGaps, proposalsOf } from './decision-pass.ts'
import { fold } from './fold.ts'
import { citePrints } from './ticket-watch.ts'
import { asksCause, buildPrompt, gateOf, parseCause, rejectedOf, storyLines } from './build-prompt.ts'
import type { Failure, GateDetail, NamedCause } from './build-prompt.ts'
import { appendPipeline, NO_USAGE } from './pipeline.ts'
import type { BuildStepEnded, StepKind, StepRef } from './pipeline.ts'
import { addAll, CHECK_TIMEOUT_MS, decidedClosure, runCheck, tail } from './loop.ts'
import type { CheckResult } from './loop.ts'
import { deferrable, grader, recordedCards, type GradeLine } from './grade.ts'
import { fileGapFollowUp } from './follow-up.ts'
import { parseSteps } from './heldout-text.ts'
import { MAIN_LINE, mainLineTip } from './merge.ts'
import { runGit, runHeadless } from './prototype.ts'
import { reviewers } from './review.ts'
import type { HeadlessResult, InflightWatch, OnAsk } from './prototype.ts'
import { classifyAsk, classifyProgress, describeToolUse } from './overseer.ts'
import { mapIndex } from './search.ts'
import { parseTicket, ticketChecks } from './ticket.ts'
import type { ParsedTicket } from './ticket.ts'
import type { Graph, GraphNode } from './types.ts'
import type { AgentRole } from './instructions.ts'

export { buildPrompt, rejectedOf, renderFailure, storyLines, type Failure } from './build-prompt.ts'

/** What only a builder session gets from the overseer: the asks (#lp-overseer-mechanics). The
 *  progress classifier and the in-flight probe watch every session (#lp-overseer). */
/** `instructions`: the session writes to the map, so it reads the werk agent instructions
 *  (#werk-agent-instructions). The builder does; the grader and the reviewers only judge. */
/** `role`: the job of the session, in its environment (#st-build-seam-role-env). `onlyTools`:
 *  the tool list is the whole tool set, and nothing can ask for more (#lp-prod-judge-read-only). */
export type SessionExtra = { role: AgentRole; signal?: AbortSignal; onAsk?: OnAsk; instructions?: boolean; onlyTools?: boolean }

/** One headless session inside a build. Its events go to their own file and to the live file. */
export type Session = (name: string, prompt: string, tools: string[], extra: SessionExtra) => Promise<HeadlessResult>

/** The overseer beyond the silence rule (#lp-overseer). Every limit is a parameter. */
export type OverseerOptions = {
  /** Answer permission asks with a classifier (#lp-overseer-asks). */
  asks?: boolean
  /** How often the progress classifier runs during each session (#lp-overseer-progress). */
  progressMs?: number
  /** The wait for one classifier verdict. */
  classifyTimeoutMs: number
  /** How a running tool call is told working from frozen (#lp-overseer-inflight). */
  inflight?: InflightWatch
}

export type GateContext = {
  worktree: string
  base: string
  ticket: ParsedTicket
  /** The spec lines of the stories the ticket delivers: in scope for the grader's scope line
   *  (#lp-prod-judge-scope). */
  stories: string[]
  /** The decided, not-stale cards of the ticket's depends_on closure: the set the builder
   *  read, and the set the grader scores — #lp-prod-judge. */
  judged: GraphNode[]
  /** The cards the pass named when it recorded "no new decision". Set only when the build's
   *  obligation holds such a record: the grader then checks the diff against them (#st-build-card). */
  followed?: GraphNode[]
  /** The last failed grade of this build: the grader checks those gaps and regressions only
   *  (#st-grade-converge). */
  earlier?: GradeLine[]
  pass: number
  session: Session
}
/** A step after green checks. `record` goes into the pass record whether it passed or not. */
export type GateOutcome = { failure?: Failure; record: Record<string, unknown> }
export type Gate = (ctx: GateContext) => Promise<GateOutcome>

/** What a pass ends with, in its pass-ended event in the pipeline log (#ms-store). */
export type PassRecord = {
  /** Why this pass was a decision pass (#st-build-missing-decision). */
  decision?: string
  turns?: number
  agentError?: string
  silent?: boolean
  commit?: string
  checks: Array<Omit<CheckResult, 'tail' | 'output'>>
  green: boolean
  failure?: Failure['kind']
  /** Which gate failed the pass (#ms-fail). */
  gate?: GateDetail
  /** The cards whose small gaps this last pass merged with, for a follow-up (#st-grade-defer). */
  deferred?: string[]
  /** Each check that was red, then green when it ran again on the same commit. Its rerun is
   *  its verdict, so it does not fail the pass (#ms-fail-cause). */
  flakyChecks?: string[]
  /** The red check could not judge the code, and why (#ms-fail-cause). */
  infra?: string
  /** The cause this pass named for the failure before it: the last pass, or a red merge on
   *  the first pass of a sent-back ticket (#ms-fail-cause). */
  causeOfLast?: { cause: NamedCause; why: string }
  /** On a first pass only: the gate of the failure the build started with (#st-build-run). */
  gateOfLast?: GateDetail
  /** This failed pass ended on a spec gap, and it does not count against the cap. `freed`: the
   *  pass before it did, as this pass named its cause (#st-build-cap-spec-gap). */
  free?: boolean
  freed?: number
  [gate: string]: unknown
}

export type BuildOptions = {
  cap: number
  passTimeoutMs: number
  /** #lp-overseer-silence: no event for this long cancels a session. */
  silenceMs: number
  checkTimeoutMs?: number
  loopRun?: string
  logPath?: string
  boardPath?: string
  pipelinePath?: string
  signal?: AbortSignal
  /** How often the builder loop reads the board for an archive of its own ticket, in ms. */
  pollMs?: number
  /** The steps after green checks, in order. */
  gates?: Gate[]
  /** The branch the build starts from. MAIN_LINE unless a test sets another. */
  mainLine?: string
  /** The target repository: its main line, its worktrees, its checks (#st-build-target). The
   *  ticket, the board, the log and the session files stay in `cwd`, the map's repository.
   *  `cwd` when not given. */
  repo?: string
  /** Start the ticket branch here instead of at the main line: the work of an earlier build
   *  that the merge queue sent back (#st-build-run). Used only if it is on top of the main line. */
  startFrom?: string
  /** After a conflict: start the ticket branch at this earlier branch and merge the main line's
   *  tip into it, so the first pass resolves the conflict instead of building again
   *  (#st-build-conflict-resolve). Falls back to a fresh start when git cannot begin the merge. */
  resolveFrom?: string
  /** The failure the first pass is told about: a red merge sends one back (#st-build-run). */
  lastFailure?: Failure
  overseer?: OverseerOptions
  /** The process to record in ticket.build.started, so the board can stop it after its own
   *  restart. Set by the `werk build` verb only: under `werk run` the process is the whole
   *  run, and a stop of one ticket must not kill it. */
  owner?: { pid: number; group: boolean }
}

export type BuildResult = {
  ticket: string
  result: BuildEnd | 'refused'
  loopRun?: string
  obligation?: string
  base?: string
  branch?: string
  passes: number
  costUsd: number
  /** The pipeline log that holds every step of this build (#ms-store). */
  pipeline?: string
  error?: string
}

/** The steps after green checks: the grader, then the review (#st-build-ticket). */
export const DEFAULT_GATES: Gate[] = [grader, reviewers]

// Skill and Agent: /implement calls /tdd and /code-review, and the review runs sub-agents.
// #st-build-implement-tools: the edit tools, make and git, and nothing else. /implement calls
// /tdd and /code-review (Skill), and the review runs sub-agents (Agent).
const BUILDER_TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash(make:*)', 'Bash(git:*)', 'Skill', 'Agent']

/** Read the ticket off the board and say why it cannot build, if it cannot. */
function readTicket(cwd: string, id: string, boardPath: string): { ticket: ParsedTicket; run: string; column: string; followUpOf?: string } | string {
  const t = foldBoard(readBoard(boardPath)).tickets.get(id)
  if (!t) return `no ticket "${id}" on the board`
  if (t.archived) return `ticket "${id}" is archived`
  if (t.openBlockers.length > 0) return `ticket "${id}" is blocked by ${t.openBlockers.join(', ')}`
  if (t.column !== 'ready' && t.column !== 'building') return `ticket "${id}" is in ${t.column}, not ready or building`
  const file = join(cwd, t.file)
  if (!existsSync(file)) return `no ticket file at ${t.file}`
  const ticket = parseTicket(t.file.split('/').pop()!, readFileSync(file, 'utf8'))
  if (!ticket) return `${t.file} has no title line`
  return { ticket, run: t.run, column: t.column, followUpOf: t.followUpOf }
}

/**
 * #werk-board-control-archive-ends-build: the builder loop reads the board about once a second
 * while it runs. When it finds its own ticket archived it stops the agent of the pass, and the
 * build ends with nothing committed, no checks and no retry. One mechanism serves a single
 * build and a build of the merge loop, with no second process that has to notice the archive.
 */
export async function build(cwd: string, g: Graph, id: string, opts: BuildOptions): Promise<BuildResult> {
  const boardPath = opts.boardPath ?? paths.board
  const archived = () => foldBoard(readBoard(boardPath)).tickets.get(id)?.archived === true
  const archive = new AbortController()
  const signal = opts.signal ? AbortSignal.any([opts.signal, archive.signal]) : archive.signal
  const poll = setInterval(() => {
    if (archived()) archive.abort()
  }, opts.pollMs ?? 1000)
  try {
    return await buildLoop(cwd, g, id, { ...opts, signal }, archived)
  } finally {
    clearInterval(poll)
  }
}

async function buildLoop(cwd: string, g: Graph, id: string, opts: BuildOptions, archived: () => boolean): Promise<BuildResult> {
  const boardPath = opts.boardPath ?? paths.board
  const logPath = resolve(opts.logPath ?? paths.log)
  const read = readTicket(cwd, id, boardPath)
  if (typeof read === 'string') return { ticket: id, result: 'refused', passes: 0, costUsd: 0, error: read }
  const { ticket, run } = read
  const repo = opts.repo ?? cwd
  // #werk-base-branch: no main line, no base to build on.
  let base: string
  try {
    base = await mainLineTip(repo, opts.mainLine ?? MAIN_LINE)
  } catch (e) {
    return { ticket: id, result: 'refused', passes: 0, costUsd: 0, error: e instanceof Error ? e.message : String(e) }
  }

  const loopRun = opts.loopRun ?? `${id.replace(/[^A-Za-z0-9_.-]+/g, '-')}-${Date.now()}`
  const runsDir = join(cwd, '.werk', 'runs')
  const sessionDir = join(runsDir, loopRun)
  const pipeline = resolve(opts.pipelinePath ?? paths.pipeline)
  const live = join(sessionDir, 'live.jsonl')
  mkdirSync(sessionDir, { recursive: true })
  const result: BuildResult = { ticket: id, result: 'error', loopRun, base, passes: 0, costUsd: 0, pipeline }
  const board = <T extends Parameters<typeof appendBoard>[0]>(type: T, payload: Parameters<typeof appendBoard<T>>[1]) =>
    appendBoard(type, payload, { path: boardPath })
  /** #ms-store: every step writes a started and an ended event. */
  const started = (step: StepKind, o: { pass?: number; name?: string; cap?: number } = {}) => {
    appendPipeline('step.started', { build: loopRun, ticket: id, step, ...o }, { path: pipeline })
    return Date.now()
  }
  const ended = (step: StepKind, since: number, o: Omit<BuildStepEnded, keyof StepRef | 'ms'> & { pass?: number; name?: string }) =>
    appendPipeline('step.ended', { build: loopRun, ticket: id, step, ms: Date.now() - since, ...o }, { path: pipeline })
  /** #ms-store-files: a check's whole output goes to a file beside the log; the event names it. */
  const checkStep = async (worktree: string, cmd: string, pass: number, file: string, rerun?: boolean) => {
    const since = started('check', { pass, name: cmd })
    const c = await runCheck(worktree, cmd, opts.checkTimeoutMs ?? CHECK_TIMEOUT_MS, opts.signal)
    const path = join(sessionDir, file)
    writeFileSync(path, c.output ?? c.tail)
    ended('check', since, { pass, name: cmd, result: c.ok ? 'ok' : 'red', code: c.code, file: relative(cwd, path), ...(rerun ? { rerun } : {}) })
    return c
  }
  let currentPass = 0

  // #st-build-card: the obligation is data in the log before any code is written.
  const obligation = `build-${loopRun}`
  append('obligation.created', { id: obligation, ticket: id, cites: ticket.cites }, { path: logPath })
  result.obligation = obligation

  if (read.column !== 'building') board('ticket.moved', { id, to: 'building' })
  board('ticket.build.started', { id, loopRun, log: relative(cwd, live), ...(opts.owner ? { pid: opts.owner.pid, group: opts.owner.group } : {}) })
  const buildSince = started('build', { cap: opts.cap })

  const specPath = join(cwd, '.werk', 'specs', `${run}.md`)
  const stories = existsSync(specPath) ? storyLines(readFileSync(specPath, 'utf8'), ticket.stories) : []
  const brief = {
    ticket,
    stories,
    cards: decidedClosure(g, ticket.cites),
    rejected: rejectedOf(g, ticket.cites),
    index: mapIndex(g),
    checks: ticketChecks(ticket),
    cap: opts.cap,
    obligation,
  }

  /** #lp-prod-judge-scope: a follow-up ticket has no spec story, and its criteria name each
   *  held-out scenario by title only. Its stories for the grader are the scenarios in full. */
  const gateStories = read.followUpOf && stories.length === 0 ? parseSteps(ticket.whatToBuild) : stories

  /** The cards this ticket's builds proposed so far, read from the log as it is now: a pass
   *  proposes while it runs (#st-build-missing-decision). */
  const proposalsNow = () => proposalsOf(fold(readEvents(logPath)), id)
  /** The decided cards that the build's "no new decision" record names, read from the log as
   *  it is now. Undefined while the obligation has no record. #werk-cli-followed */
  const followedNow = (): GraphNode[] | undefined => {
    const g = fold(readEvents(logPath))
    const names = g.obligations.get(obligation)?.followed
    if (!names) return undefined
    return names.flatMap((n) => {
      const card = g.nodes.get(n)
      return card && !card.proposed && card.status === 'decided' ? [card] : []
    })
  }

  // A fresh directory per build: two repositories may use the same loop run name.
  const worktree = mkdtempSync(join(tmpdir(), `werk-build-wt-${loopRun}-`))
  const branch = `werk-build/${loopRun}`
  /** The overseer around every session of a pass — the builder, the grader, each reviewer
   *  (#lp-overseer: it watches every running agent session). The asks classifier goes to the
   *  builder only (#lp-overseer-mechanics). */
  const ov = opts.overseer
  const ticketBrief = `${ticket.title}\n\n${ticket.whatToBuild}\n\nAcceptance criteria:\n${ticket.acceptance.map((a) => `- ${a}`).join('\n')}`
  /** #ms-cost: each overseer call is a session step of the pass it watches, with its cost. The
   *  step's name gives the overseer its own stage. */
  let overseerCalls = 0
  const record = async (file: string, call: () => Promise<HeadlessResult>) => {
    const pass = currentPass
    const name = `overseer-${++overseerCalls}`
    const since = started('session', { pass, name })
    const out = await call()
    ended('session', since, {
      pass,
      name,
      result: out.stopped ? 'stopped' : out.silent ? 'silent' : out.error ? 'error' : 'ok',
      costUsd: out.costUsd ?? NO_USAGE.costUsd,
      tokens: out.tokens ?? NO_USAGE.tokens,
      ...(out.subagents !== undefined ? { responses: out.responses, subagents: out.subagents } : {}),
      ...(out.turns !== undefined ? { turns: out.turns } : {}),
      ...(out.error ? { error: out.error } : {}),
      file: relative(cwd, file),
    })
    return out
  }
  const classifyOpts = { timeoutMs: ov?.classifyTimeoutMs ?? 60_000, sessionDir, signal: opts.signal, record }
  let asked = 0
  const onAsk: OnAsk | undefined = ov?.asks
    ? async ({ tool, input }) => {
        const v = await classifyAsk({ ...classifyOpts, brief: ticketBrief, tool, input, name: `ask-${++asked}` })
        result.costUsd += v.costUsd
        return { allow: v.allow, message: v.comment }
      }
    : undefined
  /** #lp-overseer-mechanics: an overseer act outside runHeadless is a werk_overseer line in the
   *  session's own log and in the live log, the same as one inside it. */
  const overseerLine = (name: string, event: object) => {
    const e = { type: 'werk_overseer', at: new Date().toISOString(), ...event }
    appendFileSync(join(sessionDir, `${name}.jsonl`), JSON.stringify(e) + '\n')
    appendFileSync(live, JSON.stringify({ ...e, werk_session: name }) + '\n')
  }
  /** The first looping verdict of the current pass, from any of its sessions. */
  let looping: string | undefined
  /** The progress classifier around one session: it cancels a looping session. `done()` gives
   *  its reason. */
  const watch = (name: string, outer?: AbortSignal) => {
    const ctl = new AbortController()
    const calls: string[] = []
    let verdict: string | undefined
    /** The reason of the last "not looping" verdict (#lp-overseer-cap-extend). */
    let moving: string | undefined
    let judging = false
    let n = 0
    const timer = ov?.progressMs
      ? setInterval(async () => {
          if (judging || verdict !== undefined || calls.length === 0) return
          judging = true
          try {
            // #lp-overseer-progress: only the calls since the last verdict.
            const v = await classifyProgress({ ...classifyOpts, brief: ticketBrief, calls: calls.splice(0), session: name, name: `progress-${name}-${++n}` })
            result.costUsd += v.costUsd
            if (verdict !== undefined) return
            overseerLine(name, { kind: 'progress', looping: v.looping, reason: v.reason, ...(v.looping ? { act: 'cancel the session' } : {}) })
            if (v.looping) {
              verdict = v.reason
              ctl.abort()
            } else moving = v.reason
          } finally {
            judging = false
          }
        }, ov.progressMs)
      : undefined
    return {
      signal: outer ? AbortSignal.any([outer, ctl.signal]) : ctl.signal,
      moreTime: () => moving,
      onEvent: (e: any) => {
        if (e?.type === 'assistant' && Array.isArray(e.message?.content)) {
          for (const c of e.message.content) if (c?.type === 'tool_use') calls.push(describeToolUse(c))
        }
      },
      done: () => {
        if (timer) clearInterval(timer)
        return verdict
      },
    }
  }
  const session: Session = async (name, prompt, tools, extra) => {
    const w = watch(name, extra.signal ?? opts.signal)
    const pass = currentPass
    const since = started('session', { pass, name })
    const transcript = join(sessionDir, `${name}.jsonl`)
    const out = await runHeadless(worktree, prompt, {
      timeoutMs: opts.passTimeoutMs,
      silenceMs: opts.silenceMs,
      signal: w.signal,
      tools,
      role: extra.role,
      onlyTools: extra.onlyTools,
      logPath: transcript,
      env: { WERK_LOG: logPath },
      onAsk: extra.onAsk,
      instructions: extra.instructions,
      inflight: ov?.inflight,
      moreTime: w.moreTime,
      onEvent: (e) => {
        // #vi-board-session-file: each line of the session log carries its time. An agent
        // message brings its own; a session event or a result gets the time it arrived.
        const at = e?.timestamp ?? e?.at ? {} : { at: new Date().toISOString() }
        appendFileSync(live, JSON.stringify({ ...e, ...at, werk_session: name }) + '\n')
        w.onEvent(e)
      },
    })
    const why = w.done()
    if (why !== undefined && looping === undefined) looping = why
    // Every session costs: the builder, the grader and each reviewer.
    result.costUsd += out.costUsd ?? 0
    const how = out.stopped ? 'stopped' : out.silent ? 'silent' : why !== undefined ? 'looping' : out.error ? 'error' : 'ok'
    ended('session', since, {
      pass,
      name,
      result: how,
      ...(how === 'stopped' && archived() ? { archived: true as const } : {}),
      costUsd: out.costUsd ?? NO_USAGE.costUsd,
      tokens: out.tokens ?? NO_USAGE.tokens,
      ...(out.subagents !== undefined ? { responses: out.responses, subagents: out.subagents } : {}),
      ...(out.turns !== undefined ? { turns: out.turns } : {}),
      ...(out.error ? { error: out.error } : {}),
      file: relative(cwd, transcript),
    })
    return out
  }

  let end: BuildEnd = 'cap'
  let detail: string | undefined
  /** #st-grade-defer: the small gaps the last pass merged with, for a follow-up. */
  let deferred: GradeLine[] | undefined
  try {
    // #st-build-run: a ticket sent back by the merge queue keeps its earlier work, if that
    // work still sits on top of the main line.
    let resumed = !!opts.startFrom && (await runGit(repo, ['merge-base', '--is-ancestor', base, opts.startFrom])).code === 0
    let lastFailure: Failure | undefined = opts.lastFailure
    // #st-build-conflict-resolve: after a conflict, the earlier work stays and the tip is
    // merged into it. The merge is left open on a conflict; the pass's commit closes it.
    const resolving = opts.resolveFrom ? await resolveOnto(repo, worktree, branch, opts.resolveFrom, base, id) : undefined
    if (resolving) {
      resumed = true
      if (lastFailure?.kind === 'merge') lastFailure = { ...lastFailure, resolving }
    } else {
      const add = await runGit(repo, ['worktree', 'add', '-b', branch, worktree, resumed ? opts.startFrom! : base])
      if (add.code !== 0) throw new Error(`git worktree add failed: ${add.stderr.trim()}`)
    }
    result.branch = branch
    if (existsSync(join(repo, 'node_modules')) && !existsSync(join(worktree, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(worktree, 'node_modules'))

    /** Why the next pass is a decision pass, if it is one (#st-build-missing-decision). */
    let decision: string | undefined = firstDecision(ticket.whatToBuild)
    /** #st-build-cap-spec-gap: the failed passes that ended on a spec gap. They do not count
     *  against the cap. A pass is free only after a proposal answered the last free one, so a
     *  ticket gets one free pass per open question. */
    const free = new Set<number>()
    let proposalsAtFree = -1
    const makeFree = (p: number) => {
      const n = proposalsNow().length
      if (free.has(p) || (free.size > 0 && n <= proposalsAtFree)) return false
      free.add(p)
      proposalsAtFree = n
      return true
    }
    let failed = 0
    /** #st-build-tip-in: the clashes with the main line so far, in all the passes. */
    let tipClashes = 0
    /** #st-grade-converge: the last failed grade, for the next grader. */
    let earlier: GradeLine[] | undefined
    for (let pass = 1; failed - free.size < opts.cap; pass++) {
      if (opts.signal?.aborted) {
        end = 'stopped'
        break
      }
      currentPass = pass
      const passStart = started('pass', { pass })
      looping = undefined
      const proposed = proposalsNow()
      const agent = await session(`pass-${pass}`, buildPrompt({ ...brief, pass, base, lastFailure, resumed, proposed, decision }), BUILDER_TOOLS, { role: 'builder', onAsk, instructions: true })
      if (agent.stopped && looping === undefined) {
        end = 'stopped'
        break
      }
      await addAll(worktree)
      await runGit(worktree, ['commit', '--allow-empty', '--no-verify', '-m', `werk build ${id}: pass ${pass}`])
      const record: PassRecord = {
        turns: agent.turns,
        agentError: agent.error,
        silent: agent.silent,
        commit: (await runGit(worktree, ['rev-parse', 'HEAD'])).stdout.trim(),
        checks: [],
        green: false,
      }
      const named = lastFailure && asksCause(lastFailure) ? parseCause(agent.result) : undefined
      if (named) record.causeOfLast = named
      if (decision) record.decision = decision
      // A sent-back ticket's first pass follows a red merge, which has no pass record here.
      if (pass === 1 && lastFailure) record.gateOfLast = gateOf(lastFailure)

      // #st-build-tip-in: the main line's tip goes into the branch before any check runs. A
      // clean merge moves the base to the tip, so the grader's diff stays this ticket's own.
      let tipClash: Failure | undefined
      if (looping === undefined && !agent.silent) {
        const tip = await mainLineTip(repo, opts.mainLine ?? MAIN_LINE)
        if (tip !== base) {
          const merged = await mergeTipIn(worktree, tip, id)
          if (merged === 'clean') base = tip
          else if (merged !== 'skipped') tipClash = { kind: 'merge', cmd: `git merge ${opts.mainLine ?? MAIN_LINE}`, code: 1, tail: merged.tail, conflict: true, resolving: merged.files }
        }
      }
      let failure: Failure | undefined
      if (looping !== undefined) failure = { kind: 'looping', reason: looping }
      else if (agent.silent) failure = { kind: 'silence', detail: agent.error ?? 'no event' }
      else if (tipClash) failure = tipClash
      else {
        const checks: CheckResult[] = []
        const flakyChecks: string[] = []
        for (const [i, cmd] of brief.checks.entries()) {
          let c = await checkStep(worktree, cmd, pass, `check-${pass}-${i + 1}.txt`)
          // #ms-fail-cause: a red check runs once more on the same commit. Green on the rerun is
          // the check's verdict, with the cause flaky, and the pass goes on. A check that could
          // not judge the code already has its cause, so it is not run again.
          if (!c.ok && !c.infra) {
            const rerun = await checkStep(worktree, cmd, pass, `check-${pass}-${i + 1}-rerun.txt`, true)
            if (rerun.ok) {
              flakyChecks.push(cmd)
              c = rerun
            }
          }
          checks.push(c)
          if (!c.ok) break
        }
        record.checks = checks.map((c) => ({ cmd: c.cmd, ok: c.ok, code: c.code, ms: c.ms }))
        if (flakyChecks.length) record.flakyChecks = flakyChecks
        const red = checks.find((c) => !c.ok)
        if (red) {
          failure = { kind: 'check', cmd: red.cmd, code: red.code, tail: red.tail }
          if (red.infra) record.infra = red.infra
        }
        // #st-build-missing-decision: what this ticket's builds proposed counts as decided,
        // the proposals of this very pass included.
        const judged = red ? brief.cards : [...brief.cards, ...proposalsNow()]
        const followed = red ? undefined : recordedCards(followedNow(), proposalsNow())
        // #st-grade-defer: a failure now would use up the cap.
        const lastChance = failed + 1 - free.size >= opts.cap
        for (const gate of red ? [] : (opts.gates ?? DEFAULT_GATES)) {
          const out = await gate({ worktree, base, ticket, stories: gateStories, judged, ...(followed ? { followed } : {}), ...(earlier ? { earlier } : {}), pass, session })
          Object.assign(record, out.record)
          // #lp-overseer-progress: a looping gate session is cancelled like a looping builder,
          // and the next pass gets the reason.
          if (looping !== undefined) {
            failure = { kind: 'looping', reason: looping }
            break
          }
          if (out.failure?.kind === 'grade') earlier = Array.isArray(out.record.grade) ? (out.record.grade as GradeLine[]) : out.failure.lines
          if (out.failure?.kind === 'grade' && lastChance && deferrable(out.failure.lines)) {
            deferred = out.failure.lines
            record.deferred = deferred.map((l) => l.card)
            continue
          }
          if (out.failure) {
            failure = out.failure
            break
          }
        }
      }
      if (opts.signal?.aborted) {
        end = 'stopped'
        break
      }

      record.green = !failure
      record.failure = failure?.kind
      if (failure) record.gate = gateOf(failure)
      // #st-build-cap-spec-gap: this pass ends on a spec gap when the grader says a person must
      // settle a gap. The pass before it does when this pass names its cause a spec gap.
      const freed = named?.cause === 'spec-gap' && pass > 1 && makeFree(pass - 1) ? pass - 1 : undefined
      // A clash with the main line is not the ticket's fault: the first few cost no pass
      // (#st-build-conflict, #st-build-tip-in).
      if (failure && !(failure === tipClash && tipClashes++ < MAX_FREE_CLASHES)) failed++
      if (personGaps(failure).length && makeFree(pass)) record.free = true
      if (freed) record.freed = freed
      const ms = ended('pass', passStart, { pass, result: record.green ? 'green' : 'red', pass_end: record }).payload.ms
      board('ticket.pass', { id, loopRun, pass, green: record.green, ...(record.free ? { free: true } : {}), ...(freed ? { freed } : {}) })
      result.passes = pass
      // #st-build-missing-decision: a spec gap named, or the same thing raised twice in a row,
      // makes the next pass a decision pass.
      decision = failure ? decisionTrigger({ before: lastFailure, last: failure, named }) : undefined
      if (decision) console.error(`  the next pass decides: ${decision}`)
      lastFailure = failure
      console.error(`  pass ${pass}: ${failure ? `red (${failure.kind})` : 'green'}, ${Math.round(ms / 1000)}s`)
      if (!failure) {
        end = 'green'
        break
      }
    }
    // The last read, after the checks, the grader and the review: an archive that came during
    // them still stops the build, so the ticket never moves to merging.
    if (end === 'green' && archived()) end = 'stopped'
    if (end === 'cap' && lastFailure?.kind === 'silence') end = 'silence'
    if (end === 'cap') detail = `${opts.cap} passes${free.size ? `, and ${free.size} more on a spec gap` : ''}, last failure: ${lastFailure?.kind}`
  } catch (e) {
    end = 'error'
    detail = e instanceof Error ? e.message : String(e)
    result.error = detail
  } finally {
    // The worktree goes, the branch stays: it is the record of what the passes did.
    const removed = await runGit(repo, ['worktree', 'remove', '--force', worktree])
    if (removed.code !== 0) {
      rmSync(worktree, { recursive: true, force: true })
      await runGit(repo, ['worktree', 'prune'])
    }
  }

  result.result = end
  ended('build', buildSince, { result: end, costUsd: result.costUsd, ...(detail ? { error: detail } : {}) })
  board('ticket.build.ended', { id, loopRun, result: end, ...(detail ? { detail } : {}) })
  // #st-build-ticket-broke: a broken build leaves no live session, so its ticket goes back to
  // ready with the failure as the reason. The branch stays.
  if (end === 'error' && foldBoard(readBoard(boardPath)).tickets.get(id)?.column === 'building') {
    board('ticket.moved', { id, to: 'ready', reason: `the build broke: ${detail ?? 'unknown error'}` })
  }
  // #st-build-missing-decision: the ticket now cites what its builds proposed, so a later
  // ruling on a proposal reaches it, merged or not.
  if (end === 'green') {
    const g2 = fold(readEvents(logPath))
    const ids = proposalsOf(g2, id).map((n) => n.id)
    if (ids.length) board('ticket.proposals', { id, cards: citePrints(g2, ids, { held: true }) })
  }
  // #st-grade-defer: the small gaps the ticket merges with become a follow-up after it.
  if (end === 'green' && deferred) fileGapFollowUp(cwd, { of: id, run, gaps: deferred, ticket, boardPath })
  // The merge loop takes it from here (#st-build-run).
  if (end === 'green') board('ticket.moved', { id, to: 'merging' })
  return result
}

/** The clashes with the main line that cost no pass in one build (#st-build-tip-in). */
const MAX_FREE_CLASHES = 3

/** #st-build-tip-in: merge the main line's tip into the branch checked out in `worktree`.
 *  `clean`: it merged, or the branch already had it. A clash leaves the merge open for the
 *  next pass and gives the conflicted files. `skipped`: git could not begin the merge, so the
 *  pass goes on without it and the merge queue decides. */
async function mergeTipIn(worktree: string, tip: string, id: string): Promise<'clean' | 'skipped' | { files: string[]; tail: string }> {
  const merge = await runGit(worktree, ['merge', '--no-edit', '-m', `werk build ${id}: merge the main line`, tip])
  if (merge.code === 0) return 'clean'
  const files = (await runGit(worktree, ['diff', '--name-only', '--diff-filter=U'])).stdout.split('\n').filter(Boolean)
  if (files.length) return { files, tail: tail(`${merge.stdout}\n${merge.stderr}`) }
  await runGit(worktree, ['merge', '--abort'])
  return 'skipped'
}

/** #st-build-conflict-resolve: a worktree for `branch`, started at `from` with `base` merged
 *  in. Returns the files git left conflicted, none when the merge went through. Returns
 *  undefined, with no worktree left behind, when `from` is gone or git could not begin the
 *  merge: the caller then starts fresh from `base`. */
async function resolveOnto(repo: string, worktree: string, branch: string, from: string, base: string, id: string): Promise<string[] | undefined> {
  const add = await runGit(repo, ['worktree', 'add', '-b', branch, worktree, from])
  if (add.code !== 0) return undefined
  const merge = await runGit(worktree, ['merge', '--no-edit', '-m', `werk build ${id}: merge the main line`, base])
  if (merge.code === 0) return []
  const conflicted = (await runGit(worktree, ['diff', '--name-only', '--diff-filter=U'])).stdout.split('\n').filter(Boolean)
  if (conflicted.length) return conflicted
  await runGit(repo, ['worktree', 'remove', '--force', worktree])
  await runGit(repo, ['branch', '-D', branch])
  return undefined
}
