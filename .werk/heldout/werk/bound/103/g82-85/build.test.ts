/** Held-out steps 83.x, 84.x and 85.x: the build verb with a fake builder, grader, reviewers and overseer. */
import { expect, test } from 'bun:test'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { NewEvent } from '../../src/map/events.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply, FakeScript } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, linked, logOf, proposed } from '../../src/test/map-events.ts'

/** The check passes once done.txt is there; else it prints a long output that ends in a mark. */
const MAKEFILE = [
  'check:',
  '\t@test -f done.txt || { head -c 20000 /dev/zero | tr "\\\\0" x; echo; echo "done.txt is missing TAIL-MARK"; exit 1; }',
  '',
].join('\n')

const BASE_TICKET: TicketFields = {
  number: 3,
  title: 'The thing is done',
  cites: ['loop'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt says done.',
  root: 'root',
}

const DEFAULT_MAP: NewEvent[] = [
  proposed('root', { status: 'decided' }),
  proposed('loop', { status: 'decided', parent: 'root', title: 'Write cards by appending', body: 'Part one: append. Part two: compact later.' }),
  accepted('loop'),
]

type Setup = { ticket?: Partial<TicketFields>; map?: NewEvent[] }
function project(s: Setup = {}): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(...(s.map ?? DEFAULT_MAP))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: { ...BASE_TICKET, ...s.ticket } }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want done.txt.\n')
  return p
}

const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1 } })
const red: FakeReply = { steps: [{ edit: { path: 'work.txt', content: `w${Math.random()}\n` } }, result(0.1)] }
const redN = (n: number): FakeReply => ({ steps: [{ edit: { path: 'work.txt', content: `pass ${n}\n` } }, result(0.1)] })
const green: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }

const judgeReply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: JSON.stringify(object) } }],
})
const AREAS = ['design', 'maintainability', 'tests', 'security', 'performance']
const REVIEWERS = AREAS.map((a) => `reviewer-${a}`)
const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
const gradeAll = (ids: string[], score: (id: string) => number = () => 4, gap: (id: string) => string = () => 'none') =>
  judgeReply({ lines: ids.map((id) => ({ id, score: score(id), gap: gap(id) })) })
const judges = (ids: string[]): Record<string, FakeReply | FakeReply[]> => ({
  grader: gradeAll(ids),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])),
})
const DEFAULT_LINES = ['ac-1', 'ac-2', '#loop']

const git = (p: Project, ...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]
const runRecord = (p: Project) => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const boardTicket = (p: Project) =>
  foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number, retries: t.retries })))
    .find((t) => t.number === 3)
const promptOf = (lines: unknown[]) => {
  const first = lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined
  return first?.message.content ?? ''
}
/** The prompts of one role, in launch order. A classifier gets its prompt as an argument. */
const prompts = (p: Project, role: string) => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === role ? [promptOf(lines)] : []))
}
const buildRoles = (p: Project) => p.agentRoles().filter((r) => !(r ?? '').startsWith('heldout-')) as string[]
const lastFailure = (prompt: string) => prompt.slice(prompt.indexOf('## Last failure'))
const script = (p: Project, s: FakeScript['roles']) => p.scriptAgent({ steps: [], roles: s })

// ---------- 83: the builder loop ----------

test('83.1 a ticket red once is green on the second pass, with two pass commits and two run record lines', () => {
  const p = project()
  script(p, { ...judges(DEFAULT_LINES), builder: [red, green] })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(r.stdout).toMatch(/green/)
  const branch = branchOf(r.stdout)
  const subjects = git(p, 'log', '--format=%s', `main..${branch}`).split('\n')
  expect(subjects).toHaveLength(2)
  expect(subjects[1]).toContain('pass 1')
  expect(subjects[0]).toContain('pass 2')
  const lines = runRecord(p)
  expect(lines).toHaveLength(2)
  for (const line of lines) {
    expect(Array.isArray(line.checks)).toBe(true)
    expect(line.checks.length).toBeGreaterThan(0)
    expect(typeof line.ms).toBe('number')
    expect(typeof line.costUsd).toBe('number')
  }
  expect(lines[0].checks[0].ok).toBe(false)
  expect(lines[1].checks[0].ok).toBe(true)
}, 60_000)

test('83.2 the next pass gets the last failure, cut to about 4,000 characters', () => {
  const p = project()
  script(p, { ...judges(DEFAULT_LINES), builder: [red, green] })
  expect(p.werk(['build', '3']).code).toBe(0)
  const [first, second] = prompts(p, 'builder')
  expect(second).toContain('make check')
  expect(second).toContain('TAIL-MARK')
  const failure = lastFailure(second!)
  expect(failure.length).toBeLessThanOrEqual(4200)
  expect(first).not.toContain('make check\nExit code')
  expect(first).not.toContain('TAIL-MARK')
  expect(first).not.toContain('xxxxxxxxxx')
}, 60_000)

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  const p = project()
  writeFileSync(join(p.dir, 'tip.txt'), 'new tip\n')
  p.run(['git', 'add', 'tip.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git(p, 'rev-parse', 'main')
  writeFileSync(join(p.dir, 'tip.txt'), 'local change\n')
  writeFileSync(join(p.dir, 'local.txt'), 'uncommitted\n')
  script(p, { ...judges(DEFAULT_LINES), builder: [green] })
  const r = p.werk(['build', '3'])
  const branch = branchOf(r.stdout)
  const firstPass = git(p, 'rev-list', '--reverse', `main..${branch}`).split('\n')[0]!
  expect(git(p, 'rev-parse', `${firstPass}^1`)).toBe(tip)
  for (const c of git(p, 'rev-list', `main..${branch}`).split('\n')) {
    expect(git(p, 'show', `${c}:tip.txt`)).toBe('new tip')
    expect(git(p, 'ls-tree', '--name-only', c).split('\n')).not.toContain('local.txt')
  }
  expect(readFileSync(join(p.dir, 'tip.txt'), 'utf8')).toBe('local change\n')
  expect(readFileSync(join(p.dir, 'local.txt'), 'utf8')).toBe('uncommitted\n')
}, 60_000)

test('83.4 a builder that never converges stops at 5 passes and keeps its branch', () => {
  const p = project()
  script(p, { ...judges(DEFAULT_LINES), builder: [redN(1), redN(2), redN(3), redN(4), redN(5)] })
  const r = p.werk(['build', '3'])
  expect(r.code).not.toBe(0)
  expect(buildRoles(p).filter((x) => x === 'builder')).toHaveLength(5)
  const branch = branchOf(r.stdout)
  expect(git(p, 'branch', '--list', branch)).toContain(branch)
  expect(git(p, 'rev-list', '--count', `main..${branch}`)).toBe('5')
  const lines = runRecord(p)
  expect(lines).toHaveLength(5)
  for (const line of lines) {
    expect(line.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof line.ms).toBe('number')
    expect(typeof line.costUsd).toBe('number')
  }
}, 90_000)

test('83.5 the board shows the ticket in building with its retry count', () => {
  const p = project()
  expect(boardTicket(p)?.column).toBe('ready')
  script(p, { ...judges(DEFAULT_LINES), builder: [redN(1), redN(2), green] })
  expect(p.werk(['build', '3']).code).toBe(0)
  expect(boardTicket(p)).toMatchObject({ column: 'building', retries: 2 })
}, 60_000)

// ---------- 84: the grader and the reviewers ----------

test('84.1 a grader score of 2 fails the pass, no reviewer runs, and the gap reaches the next pass', () => {
  const p = project()
  const gap = 'the diff writes the card in place, the card forbids it (done.txt:1)'
  const failing = gradeAll(DEFAULT_LINES, (id) => (id === '#loop' ? 2 : 4), (id) => (id === '#loop' ? gap : 'none'))
  script(p, { ...judges(DEFAULT_LINES), builder: [green, green], grader: [failing, gradeAll(DEFAULT_LINES)] })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = buildRoles(p)
  const secondBuilder = roles.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  expect(roles.slice(0, secondBuilder).some((x) => x.startsWith('reviewer'))).toBe(false)
  const second = prompts(p, 'builder')[1]!
  expect(second).toContain('the diff writes the card in place, the card forbids it')
  expect(second).toContain('done.txt:1')
}, 60_000)

test('84.2 the grader judges every decided card in the depends_on closure, cited or not, and no open card', () => {
  const p = project({
    ticket: { brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- First criterion.\n- Second criterion.\n- Third criterion.' },
    map: [
      proposed('root', { status: 'decided' }),
      proposed('loop', { status: 'decided', parent: 'root', title: 'The cited card' }),
      proposed('second', { status: 'decided', title: 'The uncited decided card' }),
      proposed('third', { status: 'open', title: 'The open card' }),
      accepted('loop'),
      accepted('second'),
      accepted('third'),
      linked('loop', 'second', 'depends_on'),
      linked('second', 'third', 'depends_on'),
    ],
  })
  script(p, { ...judges(['ac-1', 'ac-2', 'ac-3', '#loop', '#second']), builder: [green] })
  p.werk(['build', '3'])
  const [grader] = prompts(p, 'grader')
  const lines = grader!.slice(grader!.indexOf('## Lines'), grader!.indexOf('## Ticket'))
  expect(lines.match(/\(delivery\)/g)).toHaveLength(3)
  expect(lines.match(/\(contradiction\)/g)).toHaveLength(2)
  expect(lines).toContain('#loop (contradiction)')
  expect(lines).toContain('#second (contradiction)')
  expect(lines).not.toContain('#third')
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
}, 60_000)

test('84.3 an unbuilt part of a card passes its line, and five reviewers get the diff only', () => {
  const p = project()
  const unbuilt = gradeAll(DEFAULT_LINES, (id) => (id === '#loop' ? 3 : 4), (id) => (id === '#loop' ? 'not built yet: part two, compact later' : 'none'))
  script(p, { ...judges(DEFAULT_LINES), builder: [green], grader: unbuilt })
  const r = p.werk(['build', '3'])
  expect(r.stdout).not.toContain('red at the grader')
  const reviewers = buildRoles(p).filter((x) => x.startsWith('reviewer-'))
  expect(reviewers.toSorted()).toEqual(REVIEWERS.toSorted())
  for (const [i, area] of ['design', 'maintainability', 'tests', 'security and dependencies', 'performance'].entries()) {
    const [prompt] = prompts(p, REVIEWERS[i]!)
    expect(prompt).toContain(`${area} reviewer`)
    expect(prompt).toContain('+done')
    expect(prompt).not.toContain('Write cards by appending')
    expect(prompt).not.toContain('Make done.txt.')
    expect(prompt).not.toContain('done.txt is there.')
  }
}, 60_000)

test('84.4 a HIGH review finding fails the pass and goes into the next prompt, and the second pass runs every judge again', () => {
  const p = project()
  const high = { severity: 'HIGH', file: 'done.txt', line: 1, impact: 'the token is written to the log', fix: 'redact the token' }
  script(p, { ...judges(DEFAULT_LINES), builder: [green, green], 'reviewer-security': [reviewing([high]), reviewing()] })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the review')
  const second = prompts(p, 'builder')[1]!
  expect(second).toContain('HIGH')
  expect(second).toContain('done.txt:1')
  expect(second).toContain('the token is written to the log')
  expect(second).toContain('redact the token')
  const roles = buildRoles(p)
  const after = roles.slice(roles.indexOf('builder', 1))
  expect(after.filter((x) => x === 'grader')).toHaveLength(1)
  expect(after.filter((x) => x.startsWith('reviewer-')).toSorted()).toEqual(REVIEWERS.toSorted())
  const lines = runRecord(p)
  expect(lines[1].checks.length).toBeGreaterThan(0)
}, 60_000)

test('84.5 only MEDIUM and LOW findings let the pass go green, the ticket leaves building, and the run record keeps them', () => {
  const p = project()
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 1, impact: 'no newline', fix: 'add one' }
  script(p, { ...judges(DEFAULT_LINES), builder: [green, green], 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]) })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(buildRoles(p).filter((x) => x === 'builder')).toHaveLength(1)
  const lines = runRecord(p)
  expect(lines).toHaveLength(1)
  expect(lines[0].review.findings).toEqual([
    { area: 'maintainability', ...medium },
    { area: 'tests', ...low },
  ])
  expect(boardTicket(p)?.column).not.toBe('building')
}, 60_000)

// ---------- 85: the overseer ----------

const sessionLog = (p: Project) =>
  readFileSync(join(p.dir, '.werk', 'sessions', '3.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, isError = false) => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: isError ? 'make: *** failed' : 'ok', ...(isError && { is_error: true }) }] } },
})

test('85.1 an unanswered permission ask gets an answer from the overseer and the build continues', () => {
  const p = project()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...green.steps] }
  script(p, { ...judges(DEFAULT_LINES), builder: [asking] })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  const entries = sessionLog(p)
  const ask = entries.findIndex((e) => e.event?.type === 'control_request')
  const answered = entries.findIndex((e) => e.overseer?.act === 'answered')
  expect(ask).toBeGreaterThanOrEqual(0)
  expect(answered).toBeGreaterThan(ask)
  const settled = entries.findIndex((e) => JSON.stringify(e.event ?? {}).includes('"tool_use_id":"ask-1"'))
  expect(settled).toBeGreaterThan(answered)
  expect(entries.some((e) => e.event?.type === 'result')).toBe(true)
  const branch = branchOf(r.stdout)
  expect(git(p, 'show', `${branch}:done.txt`)).toBe('done')
}, 60_000)

test('85.2 a silent agent is cancelled with a silence limit of a few milliseconds, and a fresh pass finishes', () => {
  const p = project()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  script(p, { ...judges(DEFAULT_LINES), builder: [silent, green] })
  const r = p.werk(['build', '3', '--silence-limit', '10'])
  const lines = runRecord(p)
  expect(lines[0]).toMatchObject({ agentCancelled: 'silence' })
  expect(lines.filter((l) => l.ticket === 3)).toHaveLength(2)
  const branch = branchOf(r.stdout)
  expect(git(p, 'show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)

test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  const p = project()
  const steps = []
  for (let i = 0; i < 40; i++) steps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, true), { sleep: 20 })
  const looping: FakeReply = { steps: [...steps, { sleep: 10_000 }] }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  script(p, { ...judges(DEFAULT_LINES), builder: [looping], 'loop-classifier': classifier })
  p.werk(['build', '3', '--cap', '1', '--loop-every', '10'])
  const acts = sessionLog(p).filter((e) => e.overseer).map((e) => e.overseer.act)
  expect(acts.filter((a) => a === 'warned')).toHaveLength(1)
  const warned = acts.indexOf('warned')
  const cancelled = acts.indexOf('cancelled')
  expect(cancelled).toBeGreaterThan(warned)
  expect(sessionLog(p).filter((e) => e.overseer?.act === 'cancelled')[0].overseer.reason).toBe('loop')
  const builder = p.agentRoles().indexOf('builder')
  expect(JSON.stringify(p.agentInputs()[builder])).toContain('werk overseer')
}, 60_000)

test('85.4 a long tool call in flight is not cancelled as silence, with a silence limit of a few milliseconds', () => {
  const p = project()
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 500 }, toolResult('t1'), ...green.steps] }
  script(p, { ...judges(DEFAULT_LINES), builder: [slowTool] })
  const r = p.werk(['build', '3', '--silence-limit', '10'])
  const lines = runRecord(p)
  expect(lines.map((l) => l.agentCancelled)).toEqual([null])
  expect(lines).toHaveLength(1)
  const branch = branchOf(r.stdout)
  expect(git(p, 'show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)
