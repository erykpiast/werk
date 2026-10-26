/**
 * Held-out bindings for steps 84.x (grader and review) and 85.x (overseer).
 * "The event log" in 85.x is the run record, `.werk/runs/<run>.jsonl`: the overseer writes its acts
 * (answered, warned, cancelled) only there, in the `overseer` field of each pass line. It writes
 * nothing to the map log `.werk/log.jsonl` or to the board log `.werk/board.jsonl`.
 */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import { readLog } from '../src/map/log.ts'
import type { NewEvent } from '../src/map/events.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, linked, logOf, proposed } from '../src/test/map-events.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

/** The check passes when done.txt is there. */
const MAKEFILE = ['check:', '\t@test -f done.txt || { echo "done.txt is missing"; exit 1; }', ''].join('\n')

const baseTicket: TicketFields = {
  number: 3,
  title: 'Store the card',
  cites: ['store'],
  blockedBy: [],
  stories: [],
  touches: [],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt holds the word done.',
  root: 'root',
}

const defaultMap: NewEvent[] = [
  proposed('root', { status: 'decided' }),
  proposed('store', { status: 'decided', parent: 'root', title: 'Cards are append-only', body: 'Never write a card in place.' }),
  accepted('store'),
]

function project(fields: Partial<TicketFields> = {}, map: NewEvent[] = defaultMap): Project {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  writeFileSync(join(werk, 'log.jsonl'), logOf(...map).map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: { ...baseTicket, ...fields } }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. One.\n')
  return p
}

const result = (cost = 0.1) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2 } })
const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result()] }

const judgeReply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const grading = (ids: string[], score: (id: string) => number, gap = (_id: string) => 'none') =>
  judgeReply({ lines: ids.map((id) => ({ id, score: score(id), gap: gap(id) })) })
const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
const noFindings = () => Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()]))
const LINES = ['ac-1', 'ac-2', '#store']

const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]
/** The run record: the overseer's "event log". */
const runRecord = () => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } }).message.content
const prompts = (role = 'builder') => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === role ? [promptOf(lines)] : []))
}
const boardColumn = () =>
  foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number })))
    .find((t) => t.number === 3)?.column

test('84.1 A grader score of 2 fails the pass and the gap reaches the next pass', () => {
  project()
  const gap = 'the diff writes the card in place, the card forbids it'
  const failing = grading(LINES, (id) => (id === '#store' ? 2 : 4), (id) => (id === '#store' ? `${gap} (src/store.ts:12)` : 'none'))
  p.scriptAgent({ steps: [], roles: { ...noFindings(), builder: [finishing], grader: [failing, grading(LINES, () => 4)] } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = p.agentRoles()
  const secondBuilder = roles.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  // No reviewer runs for the first pass: between the first and the second builder, only the grader.
  expect(roles.slice(0, secondBuilder)).toEqual(['builder', 'grader'])
  const second = prompts()[1]!
  expect(second).toContain(gap)
  expect(second).toContain('src/store.ts:12')
})

test('84.2 The grader judges every decided card in the depends_on closure, cited or not', () => {
  project(
    {
      cites: ['a'],
      brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- first criterion.\n- second criterion.\n- third criterion.',
    },
    [
      proposed('root', { status: 'decided' }),
      proposed('a', { status: 'decided', parent: 'root', title: 'Card A cited' }),
      proposed('b', { status: 'decided', parent: 'root', title: 'Card B uncited' }),
      proposed('c', { status: 'open', parent: 'root', title: 'Card C open' }),
      accepted('a'),
      accepted('b'),
      accepted('c'),
      linked('a', 'b', 'depends_on'),
      linked('b', 'c', 'depends_on'),
    ],
  )
  const ids = ['ac-1', 'ac-2', 'ac-3', '#a', '#b']
  p.scriptAgent({ steps: [], roles: { ...noFindings(), builder: [finishing], grader: grading(ids, () => 4) } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: green')
  const [grader] = prompts('grader')
  const section = grader!.slice(grader!.indexOf('## Lines'), grader!.indexOf('## Ticket:'))
  const lines = section.split('\n').filter((l) => l.startsWith('- '))
  expect(lines.filter((l) => l.includes('(delivery)'))).toEqual([
    '- ac-1 (delivery): first criterion.',
    '- ac-2 (delivery): second criterion.',
    '- ac-3 (delivery): third criterion.',
  ])
  expect(lines.filter((l) => l.includes('(contradiction)'))).toEqual([
    '- #a (contradiction): Card A cited',
    '- #b (contradiction): Card B uncited',
  ])
  expect(section).not.toContain('#c')
  expect(section).not.toContain('Card C open')
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
})

test('84.3 An unbuilt part of a card passes its line and the pass goes on to the review', () => {
  project({}, [
    proposed('root', { status: 'decided' }),
    proposed('store', {
      status: 'decided',
      parent: 'root',
      title: 'Cards are append-only',
      body: 'Part 1: write done.txt. Part 2: add a retry cap.',
    }),
    accepted('store'),
  ])
  const grader = grading(LINES, (id) => (id === '#store' ? 3 : 4), (id) => (id === '#store' ? 'not built yet: part 2, the retry cap' : 'none'))
  p.scriptAgent({ steps: [], roles: { ...noFindings(), builder: [finishing], grader } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).not.toContain('red at the grader')
  const reviewerRoles = p.agentRoles().filter((x) => x?.startsWith('reviewer-'))
  expect(reviewerRoles.toSorted()).toEqual(REVIEWERS.toSorted())
  const diff = git('diff', `main..${branchOf(r.stdout)}`)
  expect(diff).toContain('+done')
  for (const [i, area] of ['design', 'maintainability', 'tests', 'security and dependencies', 'performance'].entries()) {
    const [prompt] = prompts(REVIEWERS[i])
    expect(prompt).toContain(`You are the ${area} reviewer`)
    expect(prompt).toContain('+done')
    // The diff only: no ticket brief, no card.
    expect(prompt).not.toContain('Store the card')
    expect(prompt).not.toContain('Make done.txt.')
    expect(prompt).not.toContain('Cards are append-only')
    expect(prompt).not.toContain('Part 2: add a retry cap')
  }
})

test('84.4 A HIGH review finding fails the pass and goes into the next prompt', () => {
  project()
  const high = { severity: 'HIGH', file: 'src/auth.ts', line: 42, impact: 'the token is written to the log', fix: 'redact the token before logging' }
  p.scriptAgent({
    steps: [],
    roles: { ...noFindings(), grader: grading(LINES, () => 4), builder: [finishing], 'reviewer-security': [reviewing([high]), reviewing()] },
  })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the review')
  const second = prompts()[1]
  expect(second).toBeDefined()
  expect(second).toContain('HIGH')
  expect(second).toContain('src/auth.ts:42')
  expect(second).toContain('the token is written to the log')
  expect(second).toContain('redact the token before logging')
  const roles = p.agentRoles()
  const secondBuilder = roles.indexOf('builder', 1)
  const after = roles.slice(secondBuilder + 1)
  expect(after.filter((x) => x === 'grader')).toHaveLength(1)
  expect(after.filter((x) => x?.startsWith('reviewer-')).toSorted()).toEqual(REVIEWERS.toSorted())
  const record = runRecord()
  expect(record[1].pass).toBe(2)
  expect(record[1].checks).toMatchObject([{ cmd: 'make check', ok: true }])
})

test('84.5 Only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  project()
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 1, impact: 'no newline at the end', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: {
      ...noFindings(),
      grader: grading(LINES, () => 4),
      builder: [finishing],
      'reviewer-maintainability': reviewing([medium]),
      'reviewer-tests': reviewing([low]),
    },
  })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: green')
  expect(p.agentRoles().filter((x) => x === 'builder')).toHaveLength(1)
  const [line] = runRecord()
  expect(line.review.findings).toContainEqual({ area: 'maintainability', ...medium })
  expect(line.review.findings).toContainEqual({ area: 'tests', ...low })
  expect(boardColumn()).not.toBe('building')
})

const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, isError = false) => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: isError ? 'exit 1: failed' : 'ok', is_error: isError }] } },
})
const judgesPass = () => ({ ...noFindings(), grader: grading(LINES, () => 4) })

/** "A few milliseconds" for the silence limit and the loop check interval. */
const FEW_MS = '5'

test('85.1 An unanswered permission ask gets an answer and the build continues', () => {
  project()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judgesPass(), builder: [asking] } })
  const r = p.werk(['build', '3'])
  const [line] = runRecord()
  expect(line.overseer).toContainEqual(expect.objectContaining({ act: 'answered', requestId: 'ask-1', tool: 'Bash' }))
  expect(p.agentInputs()[0]).toContainEqual(
    expect.objectContaining({ type: 'control_response', response: expect.objectContaining({ request_id: 'ask-1' }) }),
  )
  expect(line.agentExit).toBe(0)
  expect(line.agentCancelled).toBeNull()
  expect(git('show', `${branchOf(r.stdout)}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
})

test('85.2 A silent agent is cancelled and a fresh pass starts', () => {
  project()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judgesPass(), builder: [silent, finishing] } })
  const r = p.werk(['build', '3', '--silence-limit', FEW_MS])
  const record = runRecord()
  expect(record[0]).toMatchObject({ pass: 1, agentCancelled: 'silence' })
  expect(record[0].overseer).toContainEqual(expect.objectContaining({ act: 'cancelled', reason: 'silence' }))
  expect(record[1]).toMatchObject({ ticket: 3, pass: 2 })
  const branch = branchOf(r.stdout)
  expect(git('log', '--format=%s', `main..${branch}`)).toContain('werk build 3: pass 2')
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 30_000)

test('85.3 A looping agent gets one warning, then its session is cancelled', () => {
  project()
  const steps = []
  for (let i = 1; i <= 6; i++) steps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, true))
  const looping: FakeReply = { steps: [...steps, { sleep: 10_000 }] }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judgesPass(), builder: [looping], 'loop-classifier': classifier } })
  p.werk(['build', '3', '--cap', '1', '--loop-every', FEW_MS])
  const acts: { act: string; reason?: string }[] = runRecord()[0].overseer
  expect(acts.filter((a) => a.act === 'warned')).toHaveLength(1)
  const warned = acts.findIndex((a) => a.act === 'warned')
  const cancelled = acts.findIndex((a) => a.act === 'cancelled' && a.reason === 'loop')
  expect(cancelled).toBeGreaterThan(warned)
  expect(acts.slice(0, warned).some((a) => a.act === 'cancelled')).toBe(false)
}, 30_000)

test('85.4 A long tool call in flight is not cancelled as silence', () => {
  project()
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 1000 }, toolResult('t1'), ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judgesPass(), builder: [slowTool] } })
  const r = p.werk(['build', '3', '--silence-limit', FEW_MS])
  const record = runRecord()
  expect(record[0].overseer.filter((a: { act: string; reason?: string }) => a.act === 'cancelled' && a.reason === 'silence')).toEqual([])
  expect(record.filter((l: { ticket: number }) => l.ticket === 3)).toHaveLength(1)
  expect(git('show', `${branchOf(r.stdout)}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 30_000)
