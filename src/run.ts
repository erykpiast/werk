/**
 * `werk run <plan run>`: the merge loop over one planned run. See #st-build-run,
 * #st-build-parallel.
 *
 * The board is the state. Each turn of the loop folds .werk/board.jsonl and:
 *
 *   1. Moves a blocked ticket whose blockers are all done to ready, with the reason.
 *   2. Ends the build of a ticket a person archived (#werk-board-control).
 *   3. Puts one ticket in merging through the merge queue (src/merge.ts), a ticket back from a
 *      conflict first. Green: the main line moves, the ticket is done, and the held-out set
 *      starts on that commit in the background (#st-heldout-beside). Red: nothing merges, and
 *      the ticket goes back to building with the failure for its next pass. A checkout of the
 *      main line that blocks the move stops the run instead: it is not the ticket's fault. One
 *      merge at a time.
 *   4. Starts builds up to RUN_PARALLEL at once (src/build.ts): tickets in building first,
 *      then ready, each worktree off the main line's tip at its start. Two tickets that
 *      touch a module in common never build at the same time (#st-build-parallel).
 *
 * A ticket that stays red, uses its cap, or conflicts CONFLICT_LIMIT times in a row is parked
 * in blocked with the stuck hold. The tickets that need it wait behind it, and the rest go on
 * (#st-build-stuck-park). The run ends when nothing can build or merge.
 *
 * The main line is the branch `main` of the target repository: tickets build from and merge
 * onto it, with no integration branch per run (#st-plan-main, #werk-base-branch,
 * #st-build-target).
 *
 * Because the loop reads only the board, a stopped run picks up where it was when it is
 * started again. A loop that ends moves what it left in building or merging back to ready
 * (#st-build-stop-ready).
 *
 * Starting `werk run` is the person's trigger for the whole run (#werk-board-control). The
 * board's trigger on one ticket joins the run that holds it (`run.started`), or starts one.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { appendPipeline } from './pipeline.ts'
import { runCheck } from './loop.ts'
import type { CheckResult } from './loop.ts'
import { appendBoard, columns, foldBoard, readBoard, runHolder } from './board.ts'
import { paths } from './project.ts'
import { alive } from './board-routes.ts'
import type { Ticket } from './board.ts'
import { build, storyLines } from './build.ts'
import type { BuildOptions, BuildResult } from './build.ts'
import { authorSteps, checkSteps, extendFollowUp, fileFollowUp, holdSteps, readHolds, readSteps, releaseHold, rewriteSteps, runHeldout, staleSources, stepName, stepsFile } from './heldout.ts'
import type { Step } from './heldout.ts'
import { fileRedCheckFollowUp, fileStepDecision } from './follow-up.ts'
import { proposalsOf } from './decision-pass.ts'
import { decidedClosure } from './loop.ts'
import { MAIN_LINE, mainLineTip, mergeTicket } from './merge.ts'
import type { GateStage, MergeResult } from './merge.ts'
import { CONFLICT_LIMIT, dependentsOf, lastHeldout, lastMerged, mergedSteps, nextToBuild, nextToMerge, openFollowUp, passesLeft, resumeOf, STUCK_HOLD } from './run-state.ts'
import { parseTicket, ticketChecks } from './ticket.ts'
import type { ParsedTicket } from './ticket.ts'
import type { Graph } from './types.ts'

export { lastHeldout, mergeFailure } from './run-state.ts'

/** How many tickets build at the same time — #st-build-parallel. A first guess. */
export const RUN_PARALLEL = 3
/** How often a run with builds in flight looks at the board for a trigger or a stop. */
const POLL_MS = 1000
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** `gate`: build is over and G2 waits for a person. `done`: a person passed G2 for this tree.
 *  `heldout`: every ticket is merged, but a held-out step the binder cannot bind stays red.
 *  `checkout`: a merge went green, but the checkout of the main line refused the fast-forward. */
export type RunEnd = 'done' | 'gate' | 'stuck' | 'blocked' | 'heldout' | 'checkout' | 'stopped' | 'error'

/** #lp-overseer-silence-heldout: the binder's test runs are long and quiet, so its silence and
 *  in-flight limits start at 3 minutes, not the builder's 60 seconds. */
export const HELDOUT_SILENCE_MS = 180_000

export type RunOptions = Omit<BuildOptions, 'loopRun' | 'startFrom' | 'lastFailure' | 'owner'> & { heldoutSilenceMs?: number }

export type RunResult = {
  run: string
  end: RunEnd
  detail?: string
  /** #st-build-missing-decision: every card the run's builders proposed, first in the report,
   *  because each one waits for a person's ruling. `pending`: not accepted yet. */
  proposals: Array<{ card: string; title: string; ticket: string; pending: boolean }>
  builds: Array<Pick<BuildResult, 'ticket' | 'result' | 'passes' | 'branch' | 'loopRun'>>
  merges: Array<{ ticket: string; green: boolean; commit?: string; detail?: string }>
  heldout: Array<{ after: string; green: boolean; failed: string[]; binderErrors: string[]; followUps: string[] }>
  costUsd: number
}

/**
 * One merge attempt as a step of the pipeline log (#ms-store), under the build it merges.
 * Each check is a step of its own, with its whole output in a file beside the log, named by
 * the merge's start event (#ms-store-files). A check carries no pass: it is not the builder's.
 */
function mergeStep(cwd: string, path: string, t: Ticket) {
  const build = t.loopRun ?? t.id
  const ref = { build, ticket: t.id }
  const since = Date.now()
  const seq = appendPipeline('step.started', { ...ref, step: 'merge', name: 'merge' }, { path }).seq
  const dir = join(cwd, '.werk', 'runs', build)
  return {
    check: async (tree: string, cmd: string, i: number, timeoutMs: number, signal?: AbortSignal): Promise<CheckResult> => {
      const at = Date.now()
      appendPipeline('step.started', { ...ref, step: 'check', name: cmd }, { path })
      const c = await runCheck(tree, cmd, timeoutMs, signal)
      mkdirSync(dir, { recursive: true })
      const file = join(dir, `merge-${seq}-${i}.txt`)
      writeFileSync(file, c.output ?? c.tail)
      appendPipeline('step.ended', { ...ref, step: 'check', name: cmd, ms: Date.now() - at, result: c.ok ? 'ok' : 'red', code: c.code, file: relative(cwd, file) }, { path })
      return c
    },
    ended: (result: string, code?: number) =>
      appendPipeline('step.ended', { ...ref, step: 'merge', name: 'merge', ms: Date.now() - since, result, ...(code !== undefined ? { code } : {}) }, { path }),
  }
}

function readTicketFile(cwd: string, t: Ticket): ParsedTicket | undefined {
  const file = join(cwd, t.file)
  return existsSync(file) ? parseTicket(t.file.split('/').pop()!, readFileSync(file, 'utf8')) : undefined
}

export async function runPlan(cwd: string, graph: () => Graph, run: string, opts: RunOptions): Promise<RunResult> {
  const boardPath = opts.boardPath ?? paths.board
  const board = <T extends Parameters<typeof appendBoard>[0]>(type: T, payload: Parameters<typeof appendBoard<T>>[1]) =>
    appendBoard(type, payload, { path: boardPath })
  const result: RunResult = { run, end: 'done', proposals: [], builds: [], merges: [], heldout: [], costUsd: 0 }
  const sessionDir = join(cwd, '.werk', 'runs', `${run.replace(/[^A-Za-z0-9_.-]+/g, '-')}-heldout`)
  // #lp-overseer: the in-flight watch covers the binder too, whose test runs can be long and quiet.
  const pipelinePath = opts.pipelinePath ?? paths.pipeline
  const heldoutSilenceMs = opts.heldoutSilenceMs ?? HELDOUT_SILENCE_MS
  const inflight = opts.overseer?.inflight && { ...opts.overseer.inflight, flatMs: Math.max(opts.overseer.inflight.flatMs, heldoutSilenceMs) }
  const limits = { timeoutMs: opts.passTimeoutMs, silenceMs: heldoutSilenceMs, sessionDir, signal: opts.signal, inflight, pipelinePath }
  /** Ends the held-out runs in flight when the run stops for a reason that is not theirs. */
  const heldoutStop = new AbortController()
  const mainLine = opts.mainLine ?? MAIN_LINE
  // #st-build-target: git, the worktrees, the checks, the merge and the binder run in the
  // target; the board, the tickets, the specs and the steps stay in cwd.
  const repo = opts.repo ?? cwd

  /** The steps of the run's merged tickets only (#st-heldout-merged-only). */
  const heldoutSteps = () => mergedSteps(readSteps(cwd, run), mine().all)

  /** What the step author reads for one ticket: the same brief as its builder. */
  const authorBrief = (parsed: ParsedTicket, g: Graph, ticketId: string) => {
    // The cards a merged follow-up of the ticket proposed are cards the steps may rest on
    // (#st-heldout-step-contradiction).
    const proposed = mine().all.filter((t) => t.followUpOf === ticketId && t.column === 'done').flatMap((t) => proposalsOf(g, t.id))
    const cards = decidedClosure(g, parsed.cites)
    return { ticket: parsed, stories: specStories(cwd, run, parsed), cards: [...cards, ...proposed.filter((n) => !cards.some((c) => c.id === n.id))] }
  }

  /** The tickets that no merge has brought in yet: the owners a binder may name for a capability
   *  the main line lacks (#st-heldout-unbuilt-capability). A follow-up owns no scope. */
  const unmerged = () => mine().all.filter((t) => t.column !== 'done' && !t.followUpOf).map((t) => ({ id: t.id, title: t.title }))

  /** #st-heldout-step-fresh: one rewrite per ticket at a time, shared by the held-out runs that
   *  start while it runs. */
  const rewriting = new Map<string, Promise<string | undefined>>()
  /** Rewrite the steps of every merged ticket whose source card changed since they were
   *  written. Returns the tickets whose rewrite failed, with why: their steps stay stale, so
   *  they do not run. */
  const freshen = async (signal: AbortSignal): Promise<Map<string, string>> => {
    const g = graph()
    const failed = new Map<string, string>()
    const holds = readHolds(cwd, run)
    const tickets = mine().all.filter((t) => t.column === 'done' && !t.followUpOf)
    await Promise.all(
      tickets.map(async (t) => {
        const parsed = readTicketFile(cwd, t)
        if (!parsed) return
        const brief = authorBrief(parsed, g, t.id)
        // #st-heldout-step-contradiction: the held steps are rewritten from the cards and the
        // proposal once the ticket that judges them has merged.
        const hold = holds.get(t.id)
        const released = hold && mine().all.find((x) => x.id === hold.decision)?.column === 'done'
        const changed = [...staleSources(cwd, run, t.id, brief.cards), ...(released ? hold.cards : [])]
        if (!changed.length) return
        let p = rewriting.get(t.id)
        if (!p) {
          console.error(`  steps of ${t.id}: a source card changed (${changed.join(', ')}); the step author rewrites them`)
          p = rewriteSteps(cwd, { ...limits, signal, run, ticketId: t.id, brief, changed }).then((r) => {
            result.costUsd += r.costUsd
            board('ticket.steps', { id: t.id, count: r.count, file: stepsFile(cwd, run, t.id).slice(cwd.length + 1), rewritten: changed, ...(r.error ? { error: r.error } : {}) })
            if (!r.error && released) releaseHold(cwd, run, t.id)
            return r.error
          })
          rewriting.set(t.id, p)
          void p.finally(() => rewriting.delete(t.id))
        }
        const error = await p
        if (error) failed.set(t.id, error)
      }),
    )
    return failed
  }

  /** #st-validate-heldout: the held-out set runs on the main line after a merge. A red step
   *  files a follow-up, unless an open follow-up already carries it; the merge stands. A step
   *  the binder could not run files none (#st-heldout-notrun). Nor does a step whose source
   *  card changed and could not be rewritten: it does not run (#st-heldout-step-fresh). */
  const heldout = async (after: Ticket, label: string, tip?: string) => {
    const signal = limits.signal ? AbortSignal.any([limits.signal, heldoutStop.signal]) : heldoutStop.signal
    const unfresh = await freshen(signal)
    if (signal.aborted) return false
    const holds = readHolds(cwd, run)
    const all = heldoutSteps()
    const held = (s: Step) => holds.get(s.ticket)?.steps.includes(s.id) ?? false
    const steps = all.filter((s) => !unfresh.has(s.ticket) && !held(s))
    const stale = all.filter((s) => unfresh.has(s.ticket)).map((s) => `${stepName(s)}: a source card changed, and the step author could not rewrite it: ${unfresh.get(s.ticket)}`)
    // #st-heldout-step-contradiction: a step that waits for its decision is not run.
    const waiting = all.filter((s) => !unfresh.has(s.ticket) && held(s)).map((s) => `${stepName(s)}: it contradicts a decided card, and ${holds.get(s.ticket)!.decision} judges it`)
    console.error(`held-out set: ${steps.length} step(s) on ${tip?.slice(0, 8) ?? mainLine}...`)
    const h = steps.length ? await runHeldout(cwd, { ...limits, signal, run, steps, label, mainLine, tip, repo, after: after.id, unmerged: unmerged() }) : { verdicts: [], costUsd: 0 }
    result.costUsd += h.costUsd
    // A run the merge loop cut short judged nothing: it records no result.
    if (signal.aborted) return false
    const byId = new Map(steps.map((s) => [s.id, s]))
    const red = h.verdicts.filter((v) => v.result === 'fail')
    const detailOf = new Map(red.map((v) => [v.id, v.detail]))
    let failed = red.map((v) => byId.get(v.id)!)
    // #st-heldout-unbuilt-capability: a step through a capability that an unmerged ticket builds
    // is not run, and files nothing.
    const binderErrors = [
      ...stale,
      ...waiting,
      ...h.verdicts.filter((v) => v.result === 'binder-error').map((v) => `${stepName(byId.get(v.id)!)}: ${v.detail}`),
      ...h.verdicts.filter((v) => v.result === 'unbuilt').map((v) => `${stepName(byId.get(v.id)!)}: it needs a capability that ${v.owner} builds, and ${v.owner} is not merged: ${v.detail}`),
    ]
    const open = mine().all.filter((t) => t.followUpOf && t.column !== 'done')
    const covered = new Set(open.flatMap((t) => t.steps ?? []))
    const fresh = failed.filter((s) => !covered.has(s.id))
    // #st-heldout-step-contradiction: before a red step files anything, its author reads it
    // against its source cards. A contradiction files a decision follow-up, and the step waits.
    const followUps: string[] = []
    const bySourceAll = new Map<string, Step[]>()
    for (const s of fresh) bySourceAll.set(s.ticket, [...(bySourceAll.get(s.ticket) ?? []), s])
    const contradicted = new Set<string>()
    await Promise.all(
      [...bySourceAll].map(async ([source, group]) => {
        const of = mine().all.find((t) => t.id === source) ?? after
        const parsed = readTicketFile(cwd, of)
        if (!parsed) return
        const c = await checkSteps(cwd, { ...limits, signal, run, ticketId: source, brief: authorBrief(parsed, graph(), source), red: group.map((s) => ({ ...s, detail: detailOf.get(s.id) ?? '' })) })
        result.costUsd += c.costUsd
        const found = group.filter((s) => c.contradicts.has(s.id)).map((step) => ({ step, ...c.contradicts.get(step.id)! }))
        if (!found.length) return
        const id = fileStepDecision(cwd, { run, of, found, cites: parsed.cites, checks: ticketChecks(parsed), touches: parsed.touches, boardPath })
        holdSteps(cwd, run, source, { decision: id, steps: found.map((f) => f.step.id), cards: [...new Set(found.map((f) => f.card).filter(Boolean))] })
        followUps.push(id)
        for (const f of found) {
          contradicted.add(f.step.id)
          binderErrors.push(`${stepName(f.step)}: it contradicts #${f.card}, and ${id} judges it`)
        }
      }),
    )
    failed = failed.filter((s) => !contradicted.has(s.id))
    // #st-heldout-followup-per-ticket: one follow-up per source ticket of the red steps, each
    // citing its own source's cards, so one hard step holds back no other ticket's fix.
    const bySource = new Map<string, Step[]>()
    for (const s of fresh.filter((s) => !contradicted.has(s.id))) bySource.set(s.ticket, [...(bySource.get(s.ticket) ?? []), s])
    // #st-followup-one-open: a source with an open follow-up that has not started takes the new
    // steps into it; one that is building files nothing, and the run after its merge sees the
    // steps again.
    for (const [source, group] of bySource) {
      const of = mine().all.find((t) => t.id === source) ?? after
      const parsed = readTicketFile(cwd, of)
      const base = { run, of, cites: parsed?.cites ?? [], checks: parsed ? ticketChecks(parsed) : [], touches: parsed?.touches, boardPath }
      const open = openFollowUp(mine().all, source, 'steps')
      if (!open) followUps.push(fileFollowUp(cwd, { ...base, steps: group }))
      else if (open.started) console.error(`  ${group.map(stepName).join(', ')}: ${open.ticket.id} is building, so these steps wait for its merge`)
      else {
        const ids = new Set([...(open.ticket.steps ?? []), ...group.map((s) => s.id)])
        followUps.push(extendFollowUp(cwd, { ...base, open: open.ticket, steps: readSteps(cwd, run).filter((s) => ids.has(s.id)) }))
      }
    }
    // #st-heldout-notrun: a step not run is not green either, so G2 still waits for it.
    const green = failed.length === 0 && binderErrors.length === 0
    board('ticket.heldout', {
      id: after.id,
      green,
      ...(failed.length ? { failed: failed.map(stepName) } : {}),
      ...(followUps.length ? { followUps } : {}),
      ...(binderErrors.length ? { binderErrors } : {}),
    })
    result.heldout.push({ after: after.id, green, failed: failed.map(stepName), binderErrors, followUps })
    console.error(`  ${green ? 'green' : `not green: ${failed.length} failed, ${binderErrors.length} not run`}${followUps.length ? `; follow-up ${followUps.join(', ')}` : ''}`)
    return green
  }
  /** #st-heldout-followup-gate: the merge gate of a follow-up that carries red steps runs those
   *  steps, and only those, on the temporary tree. A step that ran and is red sends the ticket
   *  back to the builder, with the step's text and what the binder saw. A step not run does not
   *  block the merge. */
  const stepGate = (t: Ticket): GateStage | undefined => {
    const own = t.followUpOf && t.steps?.length ? readSteps(cwd, run).filter((s) => t.steps!.includes(s.id)) : []
    if (!own.length) return undefined
    return async (commit) => {
      console.error(`  held-out gate: ${own.length} step(s) of ${t.id} on ${commit.slice(0, 8)}...`)
      const h = await runHeldout(cwd, { ...limits, signal: opts.signal, run, steps: own, label: `gate-${t.id.split('/').pop()}`, mainLine, tip: commit, repo, after: t.id, unmerged: unmerged() })
      result.costUsd += h.costUsd
      const red = h.verdicts.filter((v) => v.result === 'fail')
      if (!red.length) return undefined
      const text = (id: string) => own.find((s) => s.id === id)!.text
      return { cmd: `held-out step ${red.map((v) => v.id).join(', ')}`, code: 1, tail: red.map((v) => `${text(v.id)}\n\nWhat the binder saw: ${v.detail}`).join('\n\n') }
    }
  }
  let rechecked = false
  let held = false
  const end = (e: RunEnd, detail?: string) => {
    result.end = e
    if (detail) result.detail = detail
    const g = graph()
    result.proposals = mine().all.flatMap((t) => proposalsOf(g, t.id).map((n) => ({ card: n.id, title: n.title, ticket: t.id, pending: !!n.proposed })))
    for (const p of result.proposals) console.error(`proposed by ${p.ticket}: #${p.card} ${p.title}${p.pending ? ' — waits for a person' : ''}`)
    if (held) {
      // #st-build-stop-ready: a stopped loop builds nothing, so no ticket stays in building or
      // merging. Every path that ends a held loop comes through here, after its builds settled.
      const reason = `the merge loop stopped: ${e}${detail ? ` — ${detail}` : ''}`
      for (const t of mine().all) {
        if (t.column === 'building' || t.column === 'merging') board('ticket.moved', { id: t.id, to: 'ready', reason, loopStop: e })
      }
      const pending = result.proposals.filter((p) => p.pending).map((p) => p.card)
      board('run.ended', { run, end: e, ...(pending.length ? { proposals: pending } : {}), ...(detail ? { detail } : {}) })
    }
    return result
  }
  const mine = () => {
    const b = foldBoard(readBoard(boardPath))
    const cols = columns(b)
    const pick = (c: keyof typeof cols) => cols[c].filter((t) => t.run === run)
    return { all: [...b.tickets.values()].filter((t) => t.run === run && !t.archived), pick }
  }

  if (mine().all.length === 0) return end('error', `no tickets of run "${run}" on the board`)
  // #werk-base-branch: every build starts from the main line and every merge moves it.
  try {
    await mainLineTip(repo, mainLine)
  } catch (e) {
    return end('error', e instanceof Error ? e.message : String(e))
  }
  // #werk-loop-tier, #st-tier-default: every run records its tier at its start, and in v0 the
  // tier is always feature, so every gate waits for a person.
  board('run.tier', { run, tier: 'feature' })

  /** #st-g2-heldout: every ticket is merged and every held-out step is green. G2 opens and
   *  the run stops until a person passes it with `werk gate <run> approve`. The gate keeps
   *  the run's key and records the main line's tip. */
  const g2 = async (reason: string) => {
    let tip: string
    try {
      tip = await mainLineTip(repo, mainLine)
    } catch (e) {
      return end('error', e instanceof Error ? e.message : String(e))
    }
    const gate = foldBoard(readBoard(boardPath)).runs.get(run)?.gates.G2
    if (gate?.passed === tip) return end('done', `G2 passed for ${tip.slice(0, 8)}`)
    if (gate?.waiting !== tip) board('gate.waiting', { run, gate: 'G2', tip, reason })
    return end('gate', `G2 waits for a person: werk gate ${run} approve --actor you`)
  }

  // One `werk run` holds a run. The board's trigger reads this to join it instead of
  // starting a second one (#werk-board-control).
  const holder = runHolder(foldBoard(readBoard(boardPath)), run, alive)
  if (holder !== undefined && holder !== process.pid) return end('error', `werk run ${run} is already running (pid ${holder})`)
  board('run.started', { run, pid: process.pid })
  held = true

  const building = new Map<string, { ac: AbortController; done: Promise<void> }>()
  /** #st-heldout-beside: held-out runs in flight, one per green merge. Each runs on its own
   *  merge's commit; the merge queue does not wait for them, the end of the run does. */
  const heldouts = new Set<Promise<void>>()
  /** A stop that is not one ticket's: an error the run cannot place on a ticket. */
  let stuck: string | undefined
  const settle = () => Promise.allSettled([...[...building.values()].map((b) => b.done), ...heldouts])
  /** #st-build-stuck-park: the ticket stops, with its reason; what needs it waits behind it. */
  const park = (id: string, why: string) => {
    board('ticket.moved', { id, to: 'blocked', reason: `stuck: ${why}`, check: STUCK_HOLD })
    console.error(`  parked ${id}: ${why}`)
  }
  /** End every build in flight: the run stops for a reason that is not theirs. */
  const stopAll = () => {
    for (const b of building.values()) b.ac.abort()
    heldoutStop.abort()
  }

  /** One build and its step author. Its own abort lets a person's stop end this build only. */
  const startOne = (next: Ticket, left: number) => {
    const ac = new AbortController()
    const signal = opts.signal ? AbortSignal.any([opts.signal, ac.signal]) : ac.signal
    const { startFrom, resolveFrom, lastFailure } = resumeOf(next)
    console.error(`building ${next.id}, ${left} pass(es) left${resolveFrom ? ', resolving a conflict' : ''}...`)
    const done = (async () => {
      const g = graph()
      const buildP = build(cwd, g, next.id, { ...opts, repo, signal, cap: left, startFrom, resolveFrom, lastFailure })
      // #lp-heldout-author: the step author starts with the builder, from the same brief. A
      // follow-up carries steps that exist already, so it gets no author.
      const parsed = readTicketFile(cwd, next)
      const authoring =
        !next.followUpOf && parsed && !existsSync(stepsFile(cwd, run, next.id))
          ? authorSteps(cwd, {
              ...limits,
              signal,
              run,
              ticketId: next.id,
              brief: authorBrief(parsed, g, next.id),
            })
          : undefined
      const [r, steps] = await Promise.all([buildP, authoring])
      if (steps) {
        result.costUsd += steps.costUsd
        board('ticket.steps', { id: next.id, count: steps.count, ...(steps.file ? { file: steps.file.slice(cwd.length + 1) } : {}), ...(steps.error ? { error: steps.error } : {}) })
        console.error(`  step author: ${steps.error ?? `${steps.count} step(s)`}`)
      }
      result.costUsd += r.costUsd
      result.builds.push({ ticket: r.ticket, result: r.result, passes: r.passes, branch: r.branch, loopRun: r.loopRun })
      // Stopped: the whole run, or a person's stop on this ticket. Neither is stuck. A refused
      // build has no ticket fault to park: the main line or the ticket file is missing.
      if (r.result === 'refused') stuck ??= `${next.id}: refused${r.error ? `: ${r.error}` : ''}`
      else if (r.result !== 'green' && r.result !== 'stopped') park(next.id, `${r.result}${r.error ? `: ${r.error}` : ''}`)
    })()
      .catch((e) => {
        stuck ??= `${next.id}: ${e instanceof Error ? e.message : String(e)}`
      })
      .finally(() => building.delete(next.id))
    return { ac, done }
  }

  for (;;) {
    if (opts.signal?.aborted) {
      await settle()
      return end('stopped')
    }
    const { pick } = mine()

    // A building ticket that went back to ready: end that build, not the run. An archive needs
    // no check here: the builder loop reads the board and ends its own build
    // (#werk-board-control-archive-ends-build).
    for (const [id, b] of building) {
      const t = mine().all.find((x) => x.id === id)
      if (t && t.column === 'ready') b.ac.abort()
    }

    // An agent's move between blocked and ready always states its reason (#werk-board-control).
    // A ticket that a failed set check holds stays, done blockers or not (#st-build-parallel).
    const unblocked = pick('blocked').filter((t) => t.openBlockers.length === 0 && !t.heldBy)
    for (const t of unblocked) {
      board('ticket.moved', { id: t.id, to: 'ready', reason: `every ticket it needs is merged: ${t.blockedBy.join(', ')}` })
    }
    if (unblocked.length) continue

    const merging = nextToMerge(pick('merging'))
    if (merging) {
      const parsed = readTicketFile(cwd, merging)
      if (!parsed) return end('error', `no readable ticket file at ${merging.file}`)
      const branch = `werk-build/${merging.loopRun}`
      console.error(`merging ${merging.id} (${branch}) into ${mainLine}...`)
      let m: MergeResult
      const step = mergeStep(cwd, pipelinePath, merging)
      try {
        m = await mergeTicket(repo, { branch, ticket: merging.id, checks: ticketChecks(parsed), mainLine, checkTimeoutMs: opts.checkTimeoutMs, signal: opts.signal, check: step.check, gate: stepGate(merging) })
      } catch (e) {
        step.ended('error')
        stopAll()
        await settle()
        return end('error', e instanceof Error ? e.message : String(e))
      }
      step.ended(m.green ? 'green' : 'checkoutBlocked' in m ? 'checkout-blocked' : m.conflict ? 'conflict' : 'red', m.green || 'checkoutBlocked' in m ? undefined : m.code)
      if (opts.signal?.aborted) {
        await settle()
        return end('stopped')
      }
      if ('checkoutBlocked' in m) {
        // Not the ticket's fault: no red merge is recorded. The stop returns it to ready, and
        // the next loop builds it on from its own branch (#st-build-stop-ready).
        const detail = `${merging.id} is green, but ${mainLine} is checked out at ${m.checkout} and the fast-forward to ${m.commit.slice(0, 8)} failed: ${m.detail}`
        result.merges.push({ ticket: merging.id, green: false, detail })
        console.error(`  ${detail}`)
        stopAll()
        await settle()
        return end('checkout', detail)
      }
      if (m.green) {
        const failedChecks = m.failed?.map((c) => c.cmd) ?? []
        board('ticket.merge', { id: merging.id, green: true, commit: m.commit, branch, ...(failedChecks.length ? { failedChecks } : {}) })
        board('ticket.moved', { id: merging.id, to: 'done' })
        result.merges.push({ ticket: merging.id, green: true, commit: m.commit })
        console.error(`  merged: ${mainLine} is at ${m.commit.slice(0, 8)}`)
        rechecked = false
        // #ms-merge-red-follow-up: the red checks the ticket merged with become a ticket of their own.
        if (m.failed?.length) {
          const f = fileRedCheckFollowUp(cwd, { of: merging.id, run: merging.run, failed: m.failed, ticket: parsed, boardPath })
          console.error(`  red checks (${failedChecks.join(', ')}): follow-up ${f}`)
        }
        // #st-heldout-beside: the set runs on this merge's commit, and the queue goes on.
        if (heldoutSteps().length) {
          const h: Promise<void> = heldout(merging, merging.id.split('/').pop()!, m.commit)
            .then(() => undefined)
            .catch((e) => {
              stuck ??= `held-out set after ${merging.id}: ${e instanceof Error ? e.message : String(e)}`
            })
            .finally(() => heldouts.delete(h))
          heldouts.add(h)
        }
      } else {
        const conflict = !!m.conflict
        board('ticket.merge', { id: merging.id, green: false, branch, cmd: m.cmd, code: m.code, detail: m.tail, ...(conflict ? { conflict } : {}) })
        // #st-build-conflict-resolve: a conflict means another ticket merged first. The next
        // build merges the tip into the ticket's branch (resumeOf) and gets a pass back
        // (passesLeft).
        const why = conflict ? `conflicts with the main line: ${m.cmd} (exit ${m.code})` : `red on the main line: ${m.cmd} (exit ${m.code})`
        board('ticket.moved', { id: merging.id, to: 'building', reason: why })
        result.merges.push({ ticket: merging.id, green: false, detail: `${m.cmd} (exit ${m.code})` })
        console.error(`  ${conflict ? 'conflict' : 'red'}: ${m.cmd} (exit ${m.code}); back to building`)
        const streak = mine().all.find((t) => t.id === merging.id)?.conflictStreak ?? 0
        if (streak >= CONFLICT_LIMIT) park(merging.id, `its merge conflicted ${streak} times in a row`)
      }
      continue
    }

    // #st-build-parallel: up to RUN_PARALLEL builds at once, in the order nextToBuild gives,
    // and never two that touch a module in common. The module names come from the ticket
    // files, which a later plan may rewrite. No new build starts once one is stuck.
    if (!stuck) {
      while (building.size < RUN_PARALLEL) {
        const touches = (t: Ticket) => readTicketFile(cwd, t)?.touches ?? []
        const next = nextToBuild(mine().all, (id) => building.has(id), touches)
        if (!next) break
        // #st-build-run-cap: the ticket's retry cap bounds the trips between the builder and
        // the merge queue. Each build gets what is left of it.
        const left = passesLeft(next, opts.cap)
        if (left <= 0) {
          park(next.id, `it used its cap of ${opts.cap} passes`)
          continue
        }
        building.set(next.id, startOne(next, left))
      }
    }
    if (building.size) {
      // Wake when a build or a held-out run ends, or to see a person's trigger or stop.
      await Promise.race([...[...building.values()].map((b) => b.done), ...heldouts, sleep(POLL_MS)])
      continue
    }
    // #st-heldout-beside: nothing builds or merges, so the run's end waits for the held-out
    // runs. One of them may file a follow-up, which is more to build.
    if (heldouts.size) {
      await Promise.race([...heldouts, sleep(POLL_MS)])
      continue
    }
    if (stuck) return end('stuck', stuck)

    const blocked = pick('blocked')
    if (blocked.length) {
      // #st-build-stuck-park: the run ends with each stuck ticket and what waits on it.
      const all = mine().all
      const parked = blocked.filter((t) => t.heldBy === STUCK_HOLD)
      if (parked.length) {
        const behind = (t: Ticket) => {
          const waiting = dependentsOf(all, t.id).filter((id) => all.find((x) => x.id === id)?.column !== 'done')
          return waiting.length ? `; ${waiting.length} ticket(s) wait on it: ${waiting.join(', ')}` : ''
        }
        return end('stuck', parked.map((t) => `${t.id} ${t.reason ?? 'is stuck'}${behind(t)}`).join(' | '))
      }
      const why = (t: Ticket) => (t.heldBy ? `${t.id} is held by the failed set check ${t.heldBy}` : `${t.id} waits on ${t.openBlockers.join(', ')}`)
      return end('blocked', blocked.map(why).join('; '))
    }

    // #st-g2-heldout: build ends when every ticket is merged and every held-out step is green.
    if (heldoutSteps().length === 0) return g2('every ticket is merged; the run has no held-out step')
    const last = lastHeldout(readBoard(boardPath), mine().all)
    if (last?.green) return g2('every ticket is merged and every held-out step is green')
    // A red result with no open follow-up: run the set once more on the final tree. A step
    // the binder still cannot bind needs a person.
    if (!rechecked) {
      rechecked = true
      // The result belongs to the last merge, so lastHeldout finds it on the tip.
      const lastId = lastMerged(readBoard(boardPath), mine().all)
      const after = mine().all.find((t) => t.id === lastId) ?? pick('done').at(-1)!
      await heldout(after, `final-${Date.now()}`)
      continue
    }
    return end('heldout', (last?.binderErrors ?? []).join('; ') || 'the held-out set is not green')
  }
}

function specStories(cwd: string, run: string, t: ParsedTicket): string[] {
  const path = join(cwd, '.werk', 'specs', `${run}.md`)
  return existsSync(path) ? storyLines(readFileSync(path, 'utf8'), t.stories) : []
}
