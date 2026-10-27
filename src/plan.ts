/**
 * The plan stage: one spec per subtree, then tickets from the spec. See #st-spec, #st-ticket,
 * #werk-loop-planner.
 *
 * Two inputs, different in kind. The scope is the subtree plus every decided card it rests
 * on, followed down and never up, in two tiers (#st-spec-linked). The scope is read in full
 * and verbatim — every card's title, why, body, rejected options, and sources — because it is
 * the brief. The rest of the map is a reference the planner consults by id and title, never
 * text it is handed.
 *
 * An open or proto card in the first tier — the subtree and the cards it links — stops the run
 * before any agent call: the planner would otherwise be free to fill the hole itself, and the
 * check on the far side could not tell a filled hole from a real answer. The second tier is
 * context: it never stops a run, and no ticket must cite it.
 *
 * Two headless agents run in order. The spec writer follows the to-spec template, the ticket
 * writer the to-tickets rules; both templates are prompt text here, and every step around them
 * is code (#pr-logic). Both skills stop to ask a person. Here an agent answers instead, and an
 * answer that no card gives comes back as data, which this file proposes as a card under the
 * subtree with `werk add` — never only in the spec (#st-spec).
 *
 * The subtree id is the key of everything a plan writes: the spec, the ticket directory and the
 * ticket ids. There is no run of its own. A second plan of the same subtree extends the first
 * (#st-plan-extend): both writers get what is already there, the open tickets are rewritten in
 * place, a ticket that started to build is never touched, and an open ticket the spec no longer
 * needs is archived (#st-plan-archive).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { appendBoard, foldBoard, readBoard } from './board.ts'
import type { BoardEventMap, PlanStep, Ticket } from './board.ts'
import { readEvents, watchTickets } from './log.ts'
import { paths } from './project.ts'
import { mapIndex, planBlockers, planScope, renderCard } from './plan-tickets.ts'
import { planCopy, scopeEntries } from './plan-record.ts'
import { appendPipeline, NO_USAGE } from './pipeline.ts'
import { citePrints } from './ticket-watch.ts'
import { runHeadless, type HeadlessResult } from './prototype.ts'
import { CHECK_TARGETS } from './rubric.ts'
import { specProblem, specStories } from './spec-text.ts'
import { checkTicketFile, checkTicketSet, TICKET_FORMAT } from './ticket.ts'
import type { ParsedTicket, TicketCheck, TicketFileChecks } from './ticket.ts'
import type { Graph } from './types.ts'

export type { TicketCheck } from './ticket.ts'
export { renderCard, subtreeCards } from './plan-tickets.ts'
export { SPEC_SECTIONS, specProblem, specStories } from './spec-text.ts'

/** A decision an agent made that no card gave. Proposed as a card under the subtree. */
export type Proposal = { id: string; title: string; why?: string; body?: string }
export type ProposalResult = { id: string; ok: boolean; detail: string }

export type PlanResult =
  | { ok: false; reason: 'blocked'; blockedBy: string[] }
  | { ok: false; reason: 'agent-error'; step: 'spec' | 'tickets'; error: string }
  | { ok: false; reason: 'spec-invalid'; spec: string; error: string }
  | {
      ok: true
      run: string
      spec: string
      dir: string
      tickets: string[]
      /** Board ids of the tickets that passed their own checks and are on the board as planned
       *  now: new ones, and open ones this plan rewrote. */
      planned: string[]
      /** Open tickets of an earlier plan that this plan archived (#st-plan-archive). */
      archived: string[]
      checks: TicketCheck[]
      proposed: ProposalResult[]
    }

const SPEC_TOOLS = ['Read', 'Grep', 'Glob', 'Write']
const TICKET_TOOLS = ['Read', 'Grep', 'Glob', 'Write']
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000
/** #lp-overseer-silence: the same limit the builder gets by default (`werk build --silence`). */
const DEFAULT_SILENCE_MS = 60 * 1000
const CLI_PATH = join(import.meta.dirname, 'cli.ts')

const HEADLESS = `You run headless. No person reads your questions, so you may not ask one and you may not use AskUserQuestion. Where the skill you follow would stop to ask a person, you answer the question yourself, from the decided cards of the subtree and the map index.`

const DECISIONS = (path: string, subtreeId: string) => `**An answer that no card gives is a new decision.** When the decided cards do not settle a question and you pick an answer, that answer must not live only in your output. Write every such answer to ${path} as a JSON array, one object per decision:

[{"id": "${subtreeId}-<short-slug>", "title": "<the decision, as a statement>", "why": "<one line: why this answer>", "body": "<the decision in full>"}]

The program proposes each one as a card under #${subtreeId}, so a person can see it and reopen it. Write \`[]\` if you made no such decision. Do not invent a decision a card already gives.`

/** The to-spec template, inlined. #st-spec: one spec per subtree. */
const SPEC_CONTRACT = (specPath: string, decisionsPath: string, subtreeId: string) => `You are the spec writer for a decision map. You are given one decided subtree, every card it links, and every further decided card those cards rest on, all in full, word for word, and an index of every other card id and title in the map, as a reference. The subtree and the cards it links are what this plan builds. The further cards are context: decisions the work must hold to, not work to plan on their own.

${HEADLESS}

Process:

1. Explore the repository to understand the current state of the code, if it helps. Use the vocabulary of the cards.
2. Sketch the seams at which the feature will be tested. Prefer existing seams to new ones. Use the highest seam possible. The fewer seams, the better — the ideal number is one. The skill would ask a person whether these seams are right. You decide, from the cards.
3. Write the spec to ${specPath}, with the template below. Write nothing else, except the decisions file.

${DECISIONS(decisionsPath, subtreeId)}

<spec-template>

## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A long, numbered list of user stories. Each one in the format:

1. As an <actor>, I want a <feature>, so that <benefit>

The list covers all aspects of the feature.

## Implementation Decisions

The decisions that were made: the modules that will be built or changed, their interfaces, architectural decisions, schema changes, API contracts, specific interactions. Cite the card id behind each decision. Do NOT include file paths or code snippets: they go out of date fast.

## Testing Decisions

What makes a good test here (external behaviour, not implementation details), which modules are tested, at which seam, and the prior art in the codebase.

## Out of Scope

What this spec does not cover.

## Further Notes

Anything else.

</spec-template>`

/** The to-tickets rules, inlined. #st-ticket: tracer bullets from the spec. */
const TICKET_CONTRACT = (dir: string, decisionsPath: string, subtreeId: string, ids: string[], stories: number[]) => `You are the ticket writer for a decision map. You are given a spec, the decided subtree and the cards it links that the spec came from, the further decided cards they rest on as context, and an index of every other card in the map.

${HEADLESS}

Break the spec into tickets: one file per ticket, at ${dir}/NN.md (NN = 01, 02, ...), numbered in dependency order, blockers first.

<vertical-slice-rules>
- Each ticket is a tracer bullet: a narrow but COMPLETE path through every layer the change touches — vertical, not a horizontal slice of one layer.
- A finished ticket can be shown working on its own.
- Each ticket fits one fresh context window.
- Any prefactoring comes first, in its own ticket. "Make the change easy, then make the easy change."
- A wide refactor — one mechanical change whose blast radius crosses the codebase — is the exception: sequence it as expand, migrate in batches, contract, each its own ticket.
</vertical-slice-rules>

The skill would ask a person three questions: is the granularity right, are the blocking edges right, should a ticket be merged or split. Answer them yourself, from the cards and the spec.

${DECISIONS(decisionsPath, subtreeId)}

Every ticket file has this exact shape:

${TICKET_FORMAT}

Rules:
- Every one of these card ids must be cited by at least one ticket: ${ids.join(', ')}.
- Every one of the spec's user stories must be delivered by at least one ticket: ${stories.join(', ')}. One story can need more than one ticket. A prefactor, a refactor or an internal fix delivers no story: leave its stories line empty, do not invent one.
- blocked_by is the delivery order, and you decide it: a ticket waits for each ticket whose code it builds on. The depends_on edges between the cited cards are a hint, not the rule. Add no blocker the build does not need: an extra blocker makes a ticket wait for nothing.
- A ticket names no file paths. They go out of date before the build reaches the ticket.
- The touches line names every module the ticket changes, by the concept it is for ("merge queue", "ticket board"), never by a file path. Two tickets that share a module never build at the same time, so a missing name lets two builds edit one module at once, and an extra name makes a ticket wait for nothing.
- Shape the work as small, single-purpose modules, one per behaviour. Put a behaviour that two tickets need into its own module, and let a shared list (of commands, routes, views) hold only the entries, so tickets that do not depend on each other touch different modules.
- Every check is \`make <target>\`, one of: ${CHECK_TARGETS.map((t) => `make ${t}`).join(', ')}.
- Write files only under ${dir}, and the decisions file. Do not write, edit, or delete anything else.`

/** What an earlier plan of the subtree left on the board, by ticket number. */
type Prior = {
  open: Map<number, Ticket>
  /** Started to build: building, merging or done. Never touched. */
  fixed: Map<number, Ticket>
  /** Archived tickets, and the follow-ups the merge loop filed. Off the plan's set, never touched. */
  reserved: Set<number>
  next: number
}

function priorTickets(boardPath: string, key: string): Prior {
  const prior: Prior = { open: new Map(), fixed: new Map(), reserved: new Set(), next: 1 }
  for (const t of foldBoard(readBoard(boardPath)).tickets.values()) {
    if (t.run !== key) continue
    const num = Number(t.id.slice(key.length + 1))
    if (!Number.isInteger(num)) continue
    prior.next = Math.max(prior.next, num + 1)
    if (t.archived || t.followUpOf) prior.reserved.add(num)
    else if (t.column === 'ready' || t.column === 'blocked') prior.open.set(num, t)
    else prior.fixed.set(num, t)
  }
  return prior
}

const nn = (num: number) => String(num).padStart(2, '0')

const EXTEND_SPEC = (specPath: string, spec: string) => `## The current spec of this subtree

An earlier plan wrote this spec to ${specPath}. Update it in place: keep what the cards still say, change what they no longer say, and add what is new. Keep the number of every user story that still holds, because existing tickets cite those numbers. A new story takes the next free number.

${spec}`

function extendTickets(dir: string, prior: Prior, read: (num: number) => string): string {
  const list = (nums: Iterable<number>) => [...nums].sort((a, b) => a - b).map(nn).join(', ') || '(none)'
  const texts = [...prior.fixed.keys(), ...prior.open.keys()]
    .sort((a, b) => a - b)
    .map((num) => `### ${nn(num)}.md (${(prior.fixed.get(num) ?? prior.open.get(num))!.column})\n\n${read(num)}`)
  return `## Tickets that already exist for this subtree

An earlier plan wrote these tickets. Extend them. Do not write a second set.

- Started to build (building, merging, done): ${list(prior.fixed.keys())}. Do not write, change or delete these files. What they cite and deliver is already covered: write tickets only for what they do not cover.
- Open (ready, blocked): ${list(prior.open.keys())}. Rewrite each one in place, under its own number, so that it fits the spec.
- Archived, or a follow-up of a failed held-out step: ${list(prior.reserved)}. Do not reuse these numbers, and do not touch these files.
- A new ticket takes the next free number, from ${nn(prior.next)} up.
- An open ticket that the spec no longer needs: do not delete its file. Write its number to ${dir}/archive.json, in a JSON array of numbers. The program archives it.

${texts.join('\n\n')}`
}

/** The numbers the ticket writer asked to archive. Anything else in the file is ignored. */
function readArchive(path: string): number[] {
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(raw) ? raw.map(Number).filter(Number.isInteger) : []
  } catch {
    return []
  }
}

/** #st-spec-decisions-answers-file: a missing file means the writer did not finish its task. An
 *  empty list means no card is missing. Why the file is unusable, or undefined. */
function answersProblem(path: string): string | undefined {
  if (!existsSync(path)) return `the writer wrote no answers file at ${path}; it must write [] when no card is missing`
  const read = readProposals(path)
  return typeof read === 'string' ? read : undefined
}

function readProposals(path: string): Proposal[] | string {
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    if (!Array.isArray(raw)) return `${path} is not a JSON array`
    return raw.filter((p): p is Proposal => typeof p?.id === 'string' && typeof p?.title === 'string')
  } catch (e) {
    return `${path} is not valid JSON: ${(e as Error).message}`
  }
}

/** Propose each decision with the werk CLI itself, against the project's log, so it gets the
 *  same checks and the same ghost status as a card a person's agent proposes (#werk-propose-new). */
function propose(cwd: string, logPath: string, subtreeId: string, path: string): ProposalResult[] {
  const read = readProposals(path)
  if (typeof read === 'string') return [{ id: '(decisions)', ok: false, detail: read }]
  return read.map((p) => {
    const args = [CLI_PATH, 'add', p.id, '--parent', subtreeId, '--who', 'me', '--title', p.title]
    if (p.why) args.push('--why', p.why)
    if (p.body) args.push('--body', p.body)
    const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, WERK_LOG: logPath } })
    return { id: p.id, ok: r.status === 0, detail: (r.status === 0 ? r.stdout : r.stderr).trim().split('\n')[0] }
  })
}

type PlanOpts = { timeoutMs?: number; silenceMs?: number; logPath?: string; boardPath?: string }

/**
 * The plan's own record in the pipeline log: the seq of its start event, and, once the writers
 * are about to run, what they were given (#ms-store-scope, #ms-store-plancopy).
 */
type PlanRecord = {
  seq?: number
  started: number
  copy?: { specPath: string; dir: string; answers: { spec: string; tickets: string }; before: { spec: string; open: Map<number, string>; known: Set<number> } }
}

/** Plan a subtree, with its start, its steps and its end on the board (#vi-board-plan). */
export async function plan(cwd: string, g: Graph, subtreeId: string, opts: PlanOpts = {}): Promise<PlanResult> {
  const boardPath = opts.boardPath ?? paths.board
  const run = subtreeId
  appendBoard('plan.started', { run, pid: process.pid }, { path: boardPath })
  const step = (s: PlanStep, log?: string) =>
    appendBoard('plan.step', log ? { run, step: s, log: relative(cwd, log) } : { run, step: s }, { path: boardPath })
  const rec: PlanRecord = { started: Date.now() }
  let result: PlanResult
  try {
    result = await planSubtree(cwd, g, subtreeId, opts, step, rec)
  } catch (e) {
    appendBoard('plan.ended', { run, result: 'error', detail: (e as Error).message }, { path: boardPath })
    endRecord(cwd, subtreeId, rec, 'error', [])
    throw e
  }
  const end = planEnd(run, result)
  appendBoard('plan.ended', end, { path: boardPath })
  endRecord(cwd, subtreeId, rec, end.result, result.ok ? result.archived : [])
  return result
}

/**
 * One writer session of the plan, in the shape of a build's session event (#ms-cost: spec and
 * ticket cost per spec). The plan's own key stands in for the build, and the subtree for the
 * ticket, so the stage fold reads it like any other session.
 */
function sessionEnded(cwd: string, subtreeId: string, rec: PlanRecord, name: string, log: string, r: HeadlessResult, since: number): void {
  appendPipeline('step.ended', {
    build: `${subtreeId}@${rec.seq}`,
    ticket: subtreeId,
    step: 'session',
    name,
    ms: Date.now() - since,
    result: r.error ? 'error' : 'ok',
    costUsd: r.costUsd ?? NO_USAGE.costUsd,
    tokens: r.tokens ?? NO_USAGE.tokens,
      ...(r.subagents !== undefined ? { responses: r.responses, subagents: r.subagents } : {}),
    ...(r.turns !== undefined ? { turns: r.turns } : {}),
    file: relative(cwd, log),
    ...(r.error ? { error: r.error } : {}),
  })
}

/**
 * End the plan's record: copy what the plan changed into a directory named by its start event,
 * and append its end event, which names that directory (#ms-store-plancopy). A ticket the plan
 * kept as it was is listed in the copy, not copied.
 */
function endRecord(cwd: string, subtreeId: string, rec: PlanRecord, result: string, archived: string[]): void {
  if (rec.seq === undefined) return
  let file: string | undefined
  if (rec.copy) {
    const { specPath, dir, before, answers } = rec.copy
    const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '')
    const tickets = new Map(
      (existsSync(dir) ? readdirSync(dir) : []).filter((f) => /^\d+\.md$/.test(f)).map((f) => [Number(f.slice(0, -3)), read(join(dir, f))]),
    )
    const spec = read(specPath)
    const copy = planCopy(before, { spec, tickets }, new Set(archived.map((id) => Number(id.slice(subtreeId.length + 1)))))
    const out = join(cwd, '.werk', 'plans', subtreeId, String(rec.seq))
    mkdirSync(out, { recursive: true })
    if (copy.spec === 'new' || copy.spec === 'changed') writeFileSync(join(out, 'spec.md'), spec)
    for (const [key, state] of Object.entries(copy.tickets)) {
      if (state === 'new' || state === 'changed') writeFileSync(join(out, `${key}.md`), tickets.get(Number(key))!)
    }
    // #werk-plancopy-answers: the answer records each writer returned, one file per writer.
    if (existsSync(answers.spec)) writeFileSync(join(out, 'spec-answers.json'), read(answers.spec))
    if (existsSync(answers.tickets)) writeFileSync(join(out, 'ticket-answers.json'), read(answers.tickets))
    writeFileSync(join(out, 'copy.json'), JSON.stringify(copy, null, 2) + '\n')
    file = relative(cwd, out)
  }
  appendPipeline('step.ended', { stage: 'plan', step: 'plan', subtree: subtreeId, plan: rec.seq, ms: Date.now() - rec.started, result, ...(file ? { file } : {}) })
}

function planEnd(run: string, r: PlanResult): BoardEventMap['plan.ended'] {
  if (r.ok) return { run, result: 'ok', planned: r.planned, archived: r.archived }
  if (r.reason === 'blocked') return { run, result: 'blocked', detail: `open or proto cards in the scope: ${r.blockedBy.join(', ')}` }
  if (r.reason === 'agent-error') return { run, result: 'agent-error', step: r.step, detail: r.error }
  return { run, result: 'spec-invalid', detail: r.error }
}

async function planSubtree(
  cwd: string,
  g: Graph,
  subtreeId: string,
  opts: PlanOpts,
  step: (s: PlanStep, log?: string) => void,
  rec: PlanRecord,
): Promise<PlanResult> {
  const { tree, linked, cards, context } = planScope(g, subtreeId)
  const logPath = opts.logPath ?? paths.log
  const subtree = [
    `## Subtree (${subtreeId})`,
    ...tree.map((n) => renderCard(g, n)),
    ...(linked.length ? [`## Cards the subtree links`, ...linked.map((n) => renderCard(g, n))] : []),
    ...(context.length ? [`## Further cards the work rests on (context)`, ...context.map((n) => renderCard(g, n))] : []),
  ].join('\n\n')
  // #ms-store-scope: what this plan reads, with the log position that gives each card's text.
  rec.seq = appendPipeline('step.started', {
    stage: 'plan',
    step: 'plan',
    subtree: subtreeId,
    scope: scopeEntries(g, readEvents(logPath), cards, context),
    size: { tier1: cards.length, tier2: context.length, chars: subtree.length },
  }).seq
  const blockedBy = planBlockers(g, subtreeId)
  if (blockedBy.length > 0) return { ok: false, reason: 'blocked', blockedBy }

  // The subtree is the key: a second plan of it finds the first one's spec and tickets.
  const run = subtreeId
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const silenceMs = opts.silenceMs ?? DEFAULT_SILENCE_MS
  const boardPath = opts.boardPath ?? paths.board
  const specDir = join(cwd, '.werk', 'specs')
  const dir = join(cwd, '.werk', 'tickets', run)
  mkdirSync(specDir, { recursive: true })
  mkdirSync(dir, { recursive: true })

  // #st-plan-extend: what an earlier plan of this subtree left. The files of tickets the plan
  // may not change are kept aside, and put back if a writer touched them.
  const prior = priorTickets(boardPath, run)
  const ticketPath = (num: number) => join(dir, `${nn(num)}.md`)
  const readTicketText = (num: number) => (existsSync(ticketPath(num)) ? readFileSync(ticketPath(num), 'utf8') : '')
  const kept = new Map([...prior.fixed.keys(), ...prior.reserved].map((num) => [num, readTicketText(num)]))

  const ids = cards.map((n) => n.id)
  const index = `## Map index (reference only)\n\n${mapIndex(g)}`

  // 1. Spec (#st-spec).
  const specPath = join(specDir, `${run}.md`)
  const specDecisions = join(specDir, `${run}.decisions.json`)
  const ticketDecisions = join(specDir, `${run}.ticket-decisions.json`)
  const archivePath = join(dir, 'archive.json')
  // An earlier plan's output files would be read again as this plan's answers.
  for (const p of [specDecisions, ticketDecisions, archivePath]) rmSync(p, { force: true })
  const priorSpec = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
  // #ms-store-plancopy: what the writers are given, to tell what they changed.
  rec.copy = {
    specPath,
    dir,
    answers: { spec: specDecisions, tickets: ticketDecisions },
    before: {
      spec: priorSpec,
      open: new Map([...prior.open.keys()].map((num) => [num, readTicketText(num)])),
      known: new Set([...prior.open.keys(), ...prior.fixed.keys(), ...prior.reserved]),
    },
  }
  const extendSpec = priorSpec ? `\n\n${EXTEND_SPEC(specPath, priorSpec)}` : ''
  // #ms-store-files: each writer's transcript is a file of this plan, so a later plan of the
  // subtree does not overwrite the file its event names.
  const sessionDir = join(cwd, '.werk', 'plans', subtreeId, String(rec.seq))
  mkdirSync(sessionDir, { recursive: true })
  const specLog = join(sessionDir, 'spec-writer.jsonl')
  step('spec', specLog)
  let since = Date.now()
  const spec = await runHeadless(cwd, `${SPEC_CONTRACT(specPath, specDecisions, subtreeId)}${extendSpec}\n\n${subtree}\n\n${index}`, {
    timeoutMs,
    silenceMs,
    tools: SPEC_TOOLS,
    role: 'spec-writer',
    logPath: specLog,
    instructions: true,
  })
  sessionEnded(cwd, subtreeId, rec, 'spec-writer', specLog, spec, since)
  if (spec.error) return { ok: false, reason: 'agent-error', step: 'spec', error: spec.error }
  const specAnswers = answersProblem(specDecisions)
  if (specAnswers) return { ok: false, reason: 'agent-error', step: 'spec', error: specAnswers }
  const proposed = propose(cwd, logPath, subtreeId, specDecisions)
  const specText = existsSync(specPath) ? readFileSync(specPath, 'utf8') : ''
  const problem = specText ? specProblem(specText) : `no spec at ${specPath}`
  if (problem) return { ok: false, reason: 'spec-invalid', spec: specPath, error: problem }
  const stories = specStories(specText)

  // 2. Tickets from the spec (#st-ticket).
  // #st-spec-decisions: each writer's decisions file sits beside the spec.
  const hasPrior = prior.open.size + prior.fixed.size + prior.reserved.size > 0
  const extend = hasPrior ? `\n\n${extendTickets(dir, prior, readTicketText)}` : ''
  const prompt = `${TICKET_CONTRACT(dir, ticketDecisions, subtreeId, ids, stories)}${extend}\n\n## Spec\n\n${specText}\n\n${subtree}\n\n${index}`
  const ticketLog = join(sessionDir, 'ticket-writer.jsonl')
  step('tickets', ticketLog)
  since = Date.now()
  const tickets = await runHeadless(cwd, prompt, {
    timeoutMs,
    silenceMs,
    tools: TICKET_TOOLS,
    role: 'ticket-writer',
    logPath: ticketLog,
    instructions: true,
  })
  sessionEnded(cwd, subtreeId, rec, 'ticket-writer', ticketLog, tickets, since)
  if (tickets.error) return { ok: false, reason: 'agent-error', step: 'tickets', error: tickets.error }
  const ticketAnswers = answersProblem(ticketDecisions)
  if (ticketAnswers) return { ok: false, reason: 'agent-error', step: 'tickets', error: ticketAnswers }
  step('checks')
  proposed.push(...propose(cwd, logPath, subtreeId, ticketDecisions))

  // A ticket that started to build, an archived one and a follow-up are not the plan's to
  // change (#st-plan-extend): whatever a writer did to their files is undone.
  for (const [num, text] of kept) if (text && readTicketText(num) !== text) writeFileSync(ticketPath(num), text)

  // #st-plan-archive: an open ticket the spec no longer needs, or whose file the writer
  // deleted, goes off the board with the reason. A restore puts it back.
  const retire = new Set(readArchive(archivePath).filter((num) => prior.open.has(num)))
  for (const num of prior.open.keys()) if (!existsSync(ticketPath(num))) retire.add(num)
  rmSync(archivePath, { force: true })
  const archived: string[] = []
  for (const num of [...retire].sort((a, b) => a - b)) {
    const id = prior.open.get(num)!.id
    appendBoard('ticket.archived', { id, reason: `the current spec of #${subtreeId} no longer needs it` }, { path: boardPath })
    archived.push(id)
  }
  const offBoard = new Set([...prior.reserved, ...retire])

  // 3. The checks (#lp-checks), then the board. A ticket that started to build is in the set:
  // what it cites and delivers counts.
  const files = readdirSync(dir)
    .filter((f) => /^\d+\.md$/.test(f) && !offBoard.has(Number(f.replace(/\.md$/, ''))))
    .sort()
  const parsed: Array<{ ticket: ParsedTicket; checks: TicketCheck[] }> = []
  const checks: TicketCheck[] = []
  const record: TicketFileChecks[] = []
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8')
    const own = checkTicketFile(f, text)
    checks.push(...own.checks)
    record.push({ file: f, chars: text.length, checks: own.checks.map(({ check, ok, detail }) => ({ check, ok, detail })) })
    if (own.ticket) parsed.push({ ticket: own.ticket, checks: own.checks })
  }
  // #st-ticket-own-checks: the record of every file the planner wrote, passed or failed.
  writeFileSync(join(dir, 'checks.json'), JSON.stringify(record, null, 2) + '\n')
  // Only tickets that passed their own checks are in the set. A failed one is not on the
  // board, so its cites and stories do not count, and as a blocker it dangles —
  // #st-ticket-set-checks.
  const setChecks = checkTicketSet(
    parsed.filter((p) => p.checks.every((c) => c.ok)).map((p) => p.ticket),
    { cardIds: ids, stories },
  )
  checks.unshift(...setChecks)

  const idOf = (num: number) => `${run}/${String(num).padStart(2, '0')}`
  const planned: string[] = []
  for (const { ticket, checks: own } of parsed) {
    const id = idOf(ticket.num)
    if (prior.fixed.has(ticket.num)) continue
    const open = prior.open.get(ticket.num)
    const failed = own.find((c) => !c.ok)
    if (failed) {
      // An open ticket already on the board that its rewrite broke is held in blocked, not
      // built from text that fails its own checks (#st-ticket-partial).
      if (open) appendBoard('ticket.moved', { id, to: 'blocked', reason: `own check ${failed.check} failed: ${failed.detail}`, check: failed.check }, { path: boardPath })
      continue
    }
    const blockedBy = ticket.blockedBy.map(idOf)
    if (!open) {
      appendBoard('ticket.planned', { id, run, file: relative(cwd, join(dir, ticket.file)), title: ticket.title, blockedBy }, { path: boardPath })
    } else if (open.title !== ticket.title || open.blockedBy.join() !== blockedBy.join()) {
      appendBoard('ticket.revised', { id, title: ticket.title, blockedBy }, { path: boardPath })
    }
    // #st-ticket-watch: the cited cards as this plan read them. A later change to one of them
    // holds the ticket; this record lifts an earlier hold.
    appendBoard('ticket.cites', { id, cards: citePrints(g, ticket.cites) }, { path: boardPath })
    planned.push(id)
  }
  // #st-ticket-partial: a failed set check that names a ticket blocks that ticket, with the
  // check as the reason. Only blocked_by names tickets.
  for (const c of setChecks) {
    if (c.ok) continue
    for (const num of c.tickets ?? []) {
      const id = idOf(num)
      if (!planned.includes(id)) continue
      appendBoard('ticket.moved', { id, to: 'blocked', reason: `set check ${c.check} failed: ${c.detail}`, check: c.check }, { path: boardPath })
    }
  }
  // The map can change while the agents write. Compare the prints with the map as it is now.
  watchTickets(readEvents(logPath), boardPath)

  return { ok: true, run, spec: specPath, dir, tickets: files, planned, archived, checks, proposed }
}
