/**
 * The held-out set. See #lp-prod-heldout, #st-validate-heldout.
 *
 * Three parts, each its own agent, none of them the builder:
 *
 *   - The step author (#lp-heldout-author) writes Given/When/Then steps (#lp-heldout-steps)
 *     from the ticket's brief, while the builder builds. It gets no tools: it cannot read the
 *     code, and the steps it answers with are stored by this file in .werk/heldout/<run>/,
 *     outside every worktree a builder works in.
 *   - The binder (#lp-heldout-binder) turns every step of the run's merged tickets
 *     (#st-heldout-merged-only) into a test on the merged tree, runs them, and reports each step: pass, fail (a missing feature), or binder-error.
 *     It works in a throwaway worktree; its tests never reach the main line. A binder that
 *     changes a file outside its test directory has fitted the code to the test, so its whole
 *     report is void.
 *   - A failed step files a follow-up ticket whose text holds that step, word for word, and
 *     no other step and no test code (#lp-heldout-feedback).
 *
 * Each steps file records the version of each card it was written from. Before a run, the
 * step author rewrites or drops the steps of a ticket whose source card changed since
 * (#st-heldout-step-fresh).
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { appendBoard } from './board.ts'
import { appendPipeline } from './pipeline.ts'
import { paths } from './project.ts'
import { writeTicketFile } from './follow-up.ts'
import type { Ticket } from './board.ts'
import { authorPrompt, binderPrompt, BOUND_DIR, changedPaths, changedSources, contradictionPrompt, followUpText, heldoutDir, holdFile, NO_STEPS, parseContradictions, parseSteps, parseVerdicts, rewritePrompt, sourcesFile, stepsFile, ticketNum } from './heldout-text.ts'
import { textPrint } from './ticket-watch.ts'
import type { Hold, RedStep, Step, StepVerdict, Unmerged } from './heldout-text.ts'
import { MAIN_LINE, mainLineTip } from './merge.ts'
import { runGit, runHeadless } from './prototype.ts'
import type { HeadlessResult, InflightWatch } from './prototype.ts'
import type { ParsedTicket } from './ticket.ts'
import type { GraphNode } from './types.ts'

export {
  authorPrompt,
  binderPrompt,
  BOUND_DIR,
  changedSources,
  followUpText,
  heldoutDir,
  parseSteps,
  parseVerdicts,
  stepName,
  stepsFile,
  type Step,
  type StepVerdict,
} from './heldout-text.ts'

const BINDER_TOOLS = ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash']

/**
 * One held-out agent session as a step of the pipeline log (#ms-store), with its cost
 * (#ms-cost) and its transcript named by the event (#ms-store-files). `build` is the held-out
 * session directory's name, the same for every session of the run.
 */
async function sessionStep(
  cwd: string,
  o: { sessionDir: string; ticket: string; name: string; pipelinePath?: string },
  transcript: string,
  run: () => Promise<HeadlessResult>,
): Promise<HeadlessResult> {
  const ref = { build: basename(o.sessionDir), ticket: o.ticket, step: 'session' as const, name: o.name }
  const path = o.pipelinePath ?? paths.pipeline
  const since = Date.now()
  appendPipeline('step.started', ref, { path })
  const out = await run()
  const result = out.stopped ? 'stopped' : out.silent ? 'silent' : out.error ? 'error' : 'ok'
  appendPipeline(
    'step.ended',
    {
      ...ref,
      ms: Date.now() - since,
      result,
      ...(out.costUsd !== undefined ? { costUsd: out.costUsd } : {}),
      ...(out.tokens ? { tokens: out.tokens } : {}),
      ...(out.subagents !== undefined ? { responses: out.responses, subagents: out.subagents } : {}),
      ...(out.turns !== undefined ? { turns: out.turns } : {}),
      ...(out.error ? { error: out.error } : {}),
      file: relative(cwd, transcript),
    },
    { path },
  )
  return out
}

/** Every stored step of the run, in ticket order. */
export function readSteps(cwd: string, run: string): Step[] {
  const dir = heldoutDir(cwd, run)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.steps.md'))
    .sort()
    .flatMap((f) => {
      const num = f.replace(/\.steps\.md$/, '')
      return readFileSync(join(dir, f), 'utf8')
        .split(/\n\s*\n/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((text, i) => ({ id: `${num}.${i + 1}`, ticket: `${run}/${num}`, text }))
    })
}

/** Run the step author for one ticket and store its steps. No tools: it only answers. */
export async function authorSteps(
  cwd: string,
  o: { run: string; ticketId: string; brief: { ticket: ParsedTicket; stories: string[]; cards: GraphNode[] }; timeoutMs: number; silenceMs: number; sessionDir: string; signal?: AbortSignal; pipelinePath?: string },
): Promise<{ file?: string; count: number; error?: string; costUsd: number }> {
  const dir = heldoutDir(cwd, o.run)
  mkdirSync(dir, { recursive: true })
  mkdirSync(o.sessionDir, { recursive: true })
  const transcript = join(o.sessionDir, `steps-${ticketNum(o.ticketId)}.jsonl`)
  const out = await sessionStep(cwd, { ...o, ticket: o.ticketId, name: `heldout-author-${ticketNum(o.ticketId)}` }, transcript, () =>
    runHeadless(dir, authorPrompt(o.brief), {
      timeoutMs: o.timeoutMs,
      silenceMs: o.silenceMs,
      signal: o.signal,
      tools: [],
      role: 'step-author',
      logPath: transcript,
    }),
  )
  const costUsd = out.costUsd ?? 0
  if (out.error) return { count: 0, error: out.error, costUsd }
  const steps = parseSteps(out.result ?? '')
  if (steps.length === 0) return { count: 0, error: 'the step author wrote no Given/When/Then scenario', costUsd }
  return { file: writeSteps(cwd, o.run, o.ticketId, steps, o.brief.cards), count: steps.length, costUsd }
}

/** The version of each card, by id, as a steps file records its sources (#st-heldout-step-fresh). */
export const sourcePrints = (cards: GraphNode[]) => Object.fromEntries(cards.map((n) => [n.id, textPrint(n)]))

/** Store the steps of one ticket and the versions of the cards they were written from. */
function writeSteps(cwd: string, run: string, ticketId: string, steps: string[], cards: GraphNode[]): string {
  const file = stepsFile(cwd, run, ticketId)
  writeFileSync(file, steps.length ? steps.join('\n\n') + '\n' : '')
  writeFileSync(sourcesFile(cwd, run, ticketId), JSON.stringify(sourcePrints(cards), null, 2) + '\n')
  return file
}

/** The source cards of one ticket's steps that changed since they were written. Empty when
 *  the ticket has no steps file (#st-heldout-step-fresh). */
export function staleSources(cwd: string, run: string, ticketId: string, cards: GraphNode[]): string[] {
  if (!existsSync(stepsFile(cwd, run, ticketId))) return []
  const path = sourcesFile(cwd, run, ticketId)
  const recorded = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>) : undefined
  return changedSources(recorded, sourcePrints(cards))
}

/** #st-heldout-step-fresh: the step author rewrites the steps of one ticket from its current
 *  cards, or drops them, after a card they came from changed. On an error the steps stay as
 *  they were, still stale. */
export async function rewriteSteps(
  cwd: string,
  o: { run: string; ticketId: string; brief: { ticket: ParsedTicket; stories: string[]; cards: GraphNode[] }; changed: string[]; timeoutMs: number; silenceMs: number; sessionDir: string; signal?: AbortSignal; pipelinePath?: string },
): Promise<{ count: number; error?: string; costUsd: number }> {
  const old = readFileSync(stepsFile(cwd, o.run, o.ticketId), 'utf8')
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
  mkdirSync(o.sessionDir, { recursive: true })
  const transcript = join(o.sessionDir, `steps-${ticketNum(o.ticketId)}-rewrite-${Date.now()}.jsonl`)
  const out = await sessionStep(cwd, { ...o, ticket: o.ticketId, name: `heldout-author-${ticketNum(o.ticketId)}` }, transcript, () =>
    runHeadless(heldoutDir(cwd, o.run), rewritePrompt({ ...o.brief, steps: old, changed: o.changed }), {
      timeoutMs: o.timeoutMs,
      silenceMs: o.silenceMs,
      signal: o.signal,
      tools: [],
      role: 'step-author',
      logPath: transcript,
    }),
  )
  const costUsd = out.costUsd ?? 0
  if (out.error) return { count: old.length, error: out.error, costUsd }
  const steps = parseSteps(out.result ?? '')
  if (steps.length === 0 && !(out.result ?? '').includes(NO_STEPS)) return { count: old.length, error: 'the step author wrote no Given/When/Then scenario', costUsd }
  writeSteps(cwd, o.run, o.ticketId, steps, o.brief.cards)
  return { count: steps.length, costUsd }
}

/** #st-heldout-step-contradiction: the step author reads the red steps of one ticket against
 *  that ticket's cards. Returns the steps that contradict a decided card, by step id. On an
 *  error nothing contradicts: the build follow-up is the safe default. */
export async function checkSteps(
  cwd: string,
  o: { run: string; ticketId: string; brief: { ticket: ParsedTicket; stories: string[]; cards: GraphNode[] }; red: RedStep[]; timeoutMs: number; silenceMs: number; sessionDir: string; signal?: AbortSignal; pipelinePath?: string },
): Promise<{ contradicts: Map<string, { card: string; why: string }>; costUsd: number }> {
  mkdirSync(o.sessionDir, { recursive: true })
  const transcript = join(o.sessionDir, `steps-${ticketNum(o.ticketId)}-check-${Date.now()}.jsonl`)
  const out = await sessionStep(cwd, { ...o, ticket: o.ticketId, name: `heldout-author-${ticketNum(o.ticketId)}` }, transcript, () =>
    runHeadless(heldoutDir(cwd, o.run), contradictionPrompt({ ...o.brief, red: o.red }), {
      timeoutMs: o.timeoutMs,
      silenceMs: o.silenceMs,
      signal: o.signal,
      tools: [],
      role: 'step-author',
      logPath: transcript,
    }),
  )
  const costUsd = out.costUsd ?? 0
  if (out.error) return { contradicts: new Map(), costUsd }
  return { contradicts: parseContradictions(out.result ?? '', o.red.map((s) => s.id)), costUsd }
}

/** The steps that wait for a decision follow-up, by source ticket (#st-heldout-step-contradiction). */
export function readHolds(cwd: string, run: string): Map<string, Hold> {
  const dir = heldoutDir(cwd, run)
  const out = new Map<string, Hold>()
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.held.json'))) out.set(`${run}/${f.replace(/\.held\.json$/, '')}`, JSON.parse(readFileSync(join(dir, f), 'utf8')) as Hold)
  return out
}

/** Hold the contradicting steps of one ticket back until `decision` merges. A second hold on the
 *  same ticket adds its steps and cards to the first. */
export function holdSteps(cwd: string, run: string, ticketId: string, hold: Hold): void {
  const old = readHolds(cwd, run).get(ticketId)
  const merged: Hold = old ? { decision: hold.decision, steps: [...new Set([...old.steps, ...hold.steps])], cards: [...new Set([...old.cards, ...hold.cards])] } : hold
  writeFileSync(holdFile(cwd, run, ticketId), JSON.stringify(merged, null, 2) + '\n')
}

/** The rewrite is done: the ticket's steps run again. */
export function releaseHold(cwd: string, run: string, ticketId: string): void {
  rmSync(holdFile(cwd, run, ticketId), { force: true })
}

export type HeldoutRun ={ verdicts: StepVerdict[]; costUsd: number; bound?: string; error?: string }

/** The binder's time per step it binds. A first guess; the binder's limit grows with the set
 *  so a large set does not time out where a small one would pass (#st-heldout-notrun). */
export const BINDER_MS_PER_STEP = 120_000

/** The binder's wall-clock limit: the configured session limit, or the per-step allowance
 *  times the steps, whichever is larger (#st-heldout-notrun). */
export function binderTimeoutMs(timeoutMs: number, steps: number): number {
  return Math.max(timeoutMs, steps * BINDER_MS_PER_STEP)
}

/** Bind and run every step on the main line's tip (#st-plan-main), in a throwaway worktree.
 *  `cwd` holds the map, the steps and the kept bound tests; `repo` is the target repository
 *  whose main line the binder runs on (#st-build-target), `cwd` when not given. */
export async function runHeldout(
  cwd: string,
  o: {
    run: string
    steps: Step[]
    timeoutMs: number
    silenceMs: number
    /** #lp-overseer-inflight: a test run the binder starts is a tool call in flight, not
     *  silence, while its process tree works. */
    inflight?: InflightWatch
    sessionDir: string
    label: string
    mainLine?: string
    /** The commit to run on, instead of the main line's tip at the start: the merge the run
     *  belongs to, while later merges move the main line beside it (#st-heldout-beside). */
    tip?: string
    signal?: AbortSignal
    repo?: string
    /** The merged ticket the run follows, for the binder's step in the pipeline log. */
    after?: string
    pipelinePath?: string
    /** The run's tickets that are not merged yet: the owners the binder may name for a
     *  capability the main line lacks (#st-heldout-unbuilt-capability). */
    unmerged?: Unmerged[]
  },
): Promise<HeldoutRun> {
  const repo = o.repo ?? cwd
  const unmerged = o.unmerged ?? []
  const tree = mkdtempSync(join(tmpdir(), 'werk-heldout-wt-'))
  const allError = (detail: string) => o.steps.map((s): StepVerdict => ({ id: s.id, result: 'binder-error', detail }))
  try {
    let tip: string
    try {
      tip = o.tip ?? (await mainLineTip(repo, o.mainLine ?? MAIN_LINE))
    } catch (e) {
      return { verdicts: allError(e instanceof Error ? e.message : String(e)), costUsd: 0 }
    }
    const add = await runGit(repo, ['worktree', 'add', '--detach', tree, tip])
    if (add.code !== 0) return { verdicts: allError(`git worktree add failed: ${add.stderr.trim()}`), costUsd: 0 }
    if (existsSync(join(repo, 'node_modules'))) symlinkSync(join(repo, 'node_modules'), join(tree, 'node_modules'))
    mkdirSync(o.sessionDir, { recursive: true })
    const transcript = join(o.sessionDir, `binder-${o.label}.jsonl`)
    const out: HeadlessResult = await sessionStep(cwd, { ...o, ticket: o.after ?? `${o.run}/${o.label}`, name: `heldout-binder-${o.label}` }, transcript, () =>
      runHeadless(tree, binderPrompt(o.steps, unmerged), {
        timeoutMs: binderTimeoutMs(o.timeoutMs, o.steps.length),
        silenceMs: o.silenceMs,
        signal: o.signal,
        inflight: o.inflight,
        tools: BINDER_TOOLS,
        role: 'binder',
        logPath: transcript,
      }),
    )
    const costUsd = out.costUsd ?? 0
    // Keep what the binder wrote, for a person; it never goes into the main line.
    let bound: string | undefined
    if (existsSync(join(tree, BOUND_DIR))) {
      bound = join(heldoutDir(cwd, o.run), 'bound', o.label)
      cpSync(join(tree, BOUND_DIR), bound, { recursive: true })
    }
    if (out.error) return { verdicts: allError(`the binder session failed: ${out.error}`), costUsd, bound, error: out.error }
    // #lp-heldout-binder rule 2: a binder that touched the product has fitted it to the test.
    // -z: raw paths. Without it git quotes a path with unusual characters, and the quote hides
    // the test directory prefix.
    const status = (await runGit(tree, ['status', '--porcelain', '-z', '--untracked-files=all'])).stdout
    const touched = changedPaths(status).filter((f) => !f.startsWith(`${BOUND_DIR}/`) && f !== 'node_modules' && !f.startsWith('node_modules/'))
    if (touched.length) return { verdicts: allError(`the binder changed files outside ${BOUND_DIR}/: ${touched.join(', ')}`), costUsd, bound }
    const verdicts = parseVerdicts(out.result ?? '', o.steps, unmerged.map((t) => t.id))
    if (typeof verdicts === 'string') return { verdicts: allError(verdicts), costUsd, bound }
    return { verdicts, costUsd, bound }
  } finally {
    const removed = await runGit(repo, ['worktree', 'remove', '--force', tree])
    if (removed.code !== 0) {
      rmSync(tree, { recursive: true, force: true })
      await runGit(repo, ['worktree', 'prune'])
    }
  }
}

/** Put more red steps into the follow-up of the same source ticket that has not started to
 *  build: its file is written again with every step, and the board revises its title and steps.
 *  Returns its id (#st-followup-one-open). */
export function extendFollowUp(
  cwd: string,
  o: { open: Ticket; of: Ticket; steps: Step[]; cites: string[]; checks: string[]; touches?: string[]; boardPath: string },
): string {
  writeFileSync(join(cwd, o.open.file), followUpText(o))
  appendBoard(
    'ticket.revised',
    { id: o.open.id, title: `Follow-up for ${o.of.id}: ${o.steps.map((s) => s.id).join(', ')}`, blockedBy: o.open.blockedBy, steps: o.steps.map((s) => s.id) },
    { path: o.boardPath },
  )
  return o.open.id
}

/** Write a follow-up ticket file and put it on the board, in ready. Returns its id. */
export function fileFollowUp(
  cwd: string,
  o: { run: string; of: Ticket; steps: Step[]; cites: string[]; checks: string[]; touches?: string[]; boardPath: string },
): string {
  const { id, file } = writeTicketFile(cwd, o.run, followUpText(o))
  appendBoard(
    'ticket.planned',
    { id, run: o.run, file, title: `Follow-up for ${o.of.id}: ${o.steps.map((s) => s.id).join(', ')}`, blockedBy: [], followUpOf: o.of.id, steps: o.steps.map((s) => s.id) },
    { path: o.boardPath },
  )
  return id
}
