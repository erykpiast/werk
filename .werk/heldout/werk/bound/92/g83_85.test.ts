/** Held-out steps 83.x, 84.x, 85.x: the build verb, with the fake agent as every role. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import type { Event } from '../src/map/events.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, linked, logOf, proposed } from '../src/test/map-events.ts'

let p: Project | undefined
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
  p = undefined
})

const T = 60_000

const DEFAULT_MAKEFILE = ['check:', '\t@test -f done.txt || { echo "done.txt is missing"; exit 1; }', ''].join('\n')

type Setup = { makefile?: string; ticket?: Partial<TicketFields>; log?: Event[] }

const baseTicket: TicketFields = {
  number: 7,
  title: 'Make the thing',
  cites: ['alpha'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt says done.',
  root: 'root',
}

function project(s: Setup = {}): Project {
  const proj = makeProject()
  p = proj
  writeFileSync(join(proj.dir, 'Makefile'), s.makefile ?? DEFAULT_MAKEFILE)
  writeFileSync(join(proj.dir, 'README.md'), 'readme\n')
  proj.run(['git', 'add', 'Makefile', 'README.md'])
  proj.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(proj.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log =
    s.log ??
    logOf(
      proposed('root', { status: 'decided' }),
      proposed('alpha', { status: 'decided', parent: 'root', title: 'Alpha card', body: 'Alpha body.' }),
      accepted('alpha'),
    )
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: { ...baseTicket, ...s.ticket } }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a person, I want done.txt.\n')
  return proj
}

const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2 } })
const working: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, result(0.1)] }
const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }
const judgeReply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
const grading = (ids: string[], score: (id: string) => number = () => 4, gap: (id: string) => string = () => 'none') =>
  judgeReply({ lines: ids.map((id) => ({ id, score: score(id), gap: gap(id) })) })
const judges = (ids: string[]): Record<string, FakeReply | FakeReply[]> => ({
  grader: grading(ids),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])),
})
const ALPHA_LINES = ['ac-1', 'ac-2', '#alpha']

const git = (...args: string[]) => p!.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]
const runRecord = () => {
  const runs = join(p!.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content ?? ''
const prompts = (role = 'builder') => {
  const roles = p!.agentRoles()
  return p!.agentInputs().flatMap((lines, i) => (roles[i] === role ? [promptOf(lines)] : []))
}
const lastFailure = (prompt: string) => prompt.slice(prompt.indexOf('## Last failure\n\n') + '## Last failure\n\n'.length)
const boardTicket = (n = 7) =>
  foldBoard(readLog<BoardEvent>(join(p!.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number, retries: t.retries })))
    .find((t) => t.number === n)

// 83.1
test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  project()
  p!.scriptAgent({ steps: [], roles: { ...judges(ALPHA_LINES), builder: [working, finishing] } })
  const r = p!.werk(['build', '7'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  const subjects = git('log', '--format=%s', `main..${branch}`).split('\n')
  expect(subjects).toHaveLength(2)
  expect(subjects[1]).toMatch(/pass 1$/)
  expect(subjects[0]).toMatch(/pass 2$/)
  const lines = runRecord()
  expect(lines).toHaveLength(2)
  for (const l of lines) {
    expect(Array.isArray(l.checks)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks).toMatchObject([{ cmd: 'make check', ok: false }])
  expect(lines[1].checks).toMatchObject([{ cmd: 'make check', ok: true }])
}, T)

// 83.2
test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  const makefile = [
    'check:',
    '\t@test -f done.txt || { head -c 20000 /dev/zero | tr "\\\\0" y; echo; echo "TAIL-OF-OUTPUT"; exit 1; }',
    '',
  ].join('\n')
  project({ makefile })
  p!.scriptAgent({ steps: [], roles: { ...judges(ALPHA_LINES), builder: [working, finishing] } })
  const r = p!.werk(['build', '7'])
  expect(r.code).toBe(0)
  const [first, second] = prompts()
  expect(second).toBeDefined()
  const failure = lastFailure(second!)
  expect(failure).toContain('make check')
  expect(failure).toContain('TAIL-OF-OUTPUT')
  expect(failure.length).toBeLessThanOrEqual(4200)
  expect(lastFailure(first!)).not.toContain('make check')
  expect(first!).not.toContain('TAIL-OF-OUTPUT')
  expect(first!).not.toContain('yyyy')
}, T)

// 83.3
test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  project()
  writeFileSync(join(p!.dir, 'new.txt'), 'new\n')
  p!.run(['git', 'add', 'new.txt'])
  p!.run(['git', 'commit', '--quiet', '-m', 'A new tip'])
  const tip = git('rev-parse', 'main')
  writeFileSync(join(p!.dir, 'README.md'), 'LOCAL-EDIT\n')
  writeFileSync(join(p!.dir, 'local-only.txt'), 'LOCAL-UNTRACKED\n')
  p!.scriptAgent({ steps: [], roles: { ...judges(ALPHA_LINES), builder: [finishing] } })
  const r = p!.werk(['build', '7'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  const commits = git('rev-list', '--reverse', `main..${branch}`).split('\n')
  expect(git('rev-parse', `${commits[0]}^1`)).toBe(tip)
  for (const c of commits) {
    expect(git('show', `${c}:README.md`)).toBe('readme')
    expect(git('ls-tree', '-r', '--name-only', c)).not.toContain('local-only.txt')
  }
  expect(readFileSync(join(p!.dir, 'README.md'), 'utf8')).toBe('LOCAL-EDIT\n')
  expect(readFileSync(join(p!.dir, 'local-only.txt'), 'utf8')).toBe('LOCAL-UNTRACKED\n')
  expect(git('status', '--porcelain')).toContain('README.md')
}, T)

// 83.4
test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  project()
  p!.scriptAgent({ steps: [], roles: { ...judges(ALPHA_LINES), builder: [working] } })
  const r = p!.werk(['build', '7'])
  expect(r.code).not.toBe(0)
  const branch = branchOf(r.stdout)
  expect(git('rev-parse', '--verify', branch)).not.toBe('')
  expect(git('rev-list', '--count', `main..${branch}`)).toBe('5')
  const lines = runRecord()
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
}, T)

// 83.5
test('83.5 the board shows the ticket in building with its retry count', () => {
  project()
  expect(boardTicket()).toMatchObject({ column: 'ready' })
  p!.scriptAgent({ steps: [], roles: { ...judges(ALPHA_LINES), builder: [working, working, finishing] } })
  const r = p!.werk(['build', '7'])
  expect(r.code).toBe(0)
  expect(boardTicket()).toEqual({ column: 'building', number: 7, retries: 2 })
}, T)

// 84.1
test('84.1 a grader score of 2 fails the pass and the gap reaches the next pass', () => {
  project()
  const gap = 'the diff writes the card in place, the card forbids it'
  const failing = grading(ALPHA_LINES, (id) => (id === '#alpha' ? 2 : 4), (id) => (id === '#alpha' ? `${gap} (done.txt:1)` : 'none'))
  p!.scriptAgent({ steps: [], roles: { ...judges(ALPHA_LINES), builder: [finishing], grader: [failing, grading(ALPHA_LINES)] } })
  const r = p!.werk(['build', '7'])
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = p!.agentRoles()
  const secondBuilder = roles.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  expect(roles.slice(0, secondBuilder).some((x) => x?.startsWith('reviewer-'))).toBe(false)
  const failure = lastFailure(prompts()[1]!)
  expect(failure).toContain(gap)
  expect(failure).toContain('done.txt:1')
}, T)

// 84.2
test('84.2 the grader judges every decided card in the depends_on closure, cited or not', () => {
  const log = logOf(
    proposed('root', { status: 'decided' }),
    proposed('alpha', { status: 'decided', parent: 'root', title: 'Alpha card' }),
    proposed('beta', { status: 'decided', title: 'Beta card' }),
    proposed('gamma', { status: 'open', title: 'Gamma open card' }),
    accepted('alpha'),
    accepted('beta'),
    accepted('gamma'),
    linked('alpha', 'beta', 'depends_on'),
    linked('beta', 'gamma', 'depends_on'),
  )
  const brief = '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- crit one.\n- crit two.\n- crit three.'
  project({ log, ticket: { brief } })
  const ids = ['ac-1', 'ac-2', 'ac-3', '#alpha', '#beta']
  p!.scriptAgent({ steps: [], roles: { ...judges(ids), builder: [finishing] } })
  const r = p!.werk(['build', '7'])
  expect(r.code).toBe(0)
  const [grader] = prompts('grader')
  const lines = grader!.slice(grader!.indexOf('## Lines'), grader!.indexOf('## Ticket'))
  expect((lines.match(/\(delivery\)/g) ?? []).length).toBe(3)
  expect(lines).toContain('#alpha (contradiction)')
  expect(lines).toContain('#beta (contradiction)')
  expect(lines).not.toContain('gamma')
  expect((lines.match(/\(contradiction\)/g) ?? []).length).toBe(2)
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
}, T)

// 84.3
test('84.3 an unbuilt part of a card passes its line and the pass goes on to the review', () => {
  const log = logOf(
    proposed('root', { status: 'decided' }),
    proposed('alpha', { status: 'decided', parent: 'root', title: 'Alpha card', body: 'Part one: done.txt. Part two: CARD-PART-TWO.' }),
    accepted('alpha'),
  )
  project({ log })
  const unbuilt = grading(ALPHA_LINES, (id) => (id === '#alpha' ? 3 : 4), (id) => (id === '#alpha' ? 'part two: not built yet' : 'none'))
  p!.scriptAgent({ steps: [], roles: { ...judges(ALPHA_LINES), builder: [finishing], grader: unbuilt } })
  const r = p!.werk(['build', '7'])
  expect(r.stdout).not.toContain('red at the grader')
  const roles = p!.agentRoles().filter((x) => x?.startsWith('reviewer-'))
  expect(roles.toSorted()).toEqual(REVIEWERS.toSorted())
  for (const role of REVIEWERS) {
    const [prompt] = prompts(role)
    expect(prompt).toContain('+done')
    expect(prompt).not.toContain('CARD-PART-TWO')
    expect(prompt).not.toContain('Alpha card')
    expect(prompt).not.toContain('Make done.txt.')
  }
}, T)

// 84.4
test('84.4 a HIGH review finding fails the pass and goes into the next prompt', () => {
  project()
  const high = { severity: 'HIGH', file: 'done.txt', line: 1, impact: 'the token is written to the log', fix: 'redact the token' }
  p!.scriptAgent({ steps: [], roles: { ...judges(ALPHA_LINES), builder: [finishing], 'reviewer-security': [reviewing([high]), reviewing()] } })
  const r = p!.werk(['build', '7'])
  expect(r.stdout).toContain('pass 1: red at the review')
  const second = prompts()[1]
  expect(second).toBeDefined()
  const failure = lastFailure(second!)
  expect(failure).toContain('HIGH')
  expect(failure).toContain('done.txt:1')
  expect(failure).toContain('the token is written to the log')
  expect(failure).toContain('redact the token')
  const roles = p!.agentRoles()
  const secondBuilder = roles.indexOf('builder', 1)
  const after = roles.slice(secondBuilder + 1)
  expect(after).toContain('grader')
  expect(after.filter((x) => x?.startsWith('reviewer-')).toSorted()).toEqual(REVIEWERS.toSorted())
  const lines = runRecord()
  expect(lines[1].checks.length).toBeGreaterThan(0)
  expect(lines[1].grade).toBeDefined()
  expect(lines[1].review).toBeDefined()
}, T)

// 84.5
test('84.5 only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  project()
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 2, impact: 'no newline', fix: 'add one' }
  p!.scriptAgent({
    steps: [],
    roles: { ...judges(ALPHA_LINES), builder: [finishing], 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]) },
  })
  const r = p!.werk(['build', '7'])
  expect(r.code).toBe(0)
  expect(p!.agentRoles().filter((x) => x === 'builder')).toHaveLength(1)
  const lines = runRecord()
  expect(lines).toHaveLength(1)
  expect(lines[0].review.findings).toEqual(expect.arrayContaining([expect.objectContaining(medium), expect.objectContaining(low)]))
  // The ticket leaves building.
  expect(boardTicket()?.column).not.toBe('building')
}, T)

/** The overseer. */
const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, content = 'ok') => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } },
})

// 85.1
test('85.1 an unanswered permission ask gets an answer and the build continues', () => {
  project()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...finishing.steps] }
  p!.scriptAgent({ steps: [], roles: { ...judges(ALPHA_LINES), builder: [asking] } })
  const r = p!.werk(['build', '7'])
  expect(r.code).toBe(0)
  const [line] = runRecord()
  expect(line.overseer).toContainEqual(expect.objectContaining({ act: 'answered', requestId: 'ask-1', tool: 'Bash' }))
  expect(line.agentExit).toBe(0)
  const branch = branchOf(r.stdout)
  expect(git('show', `${branch}:done.txt`)).toBe('done')
}, T)

// 85.2
test('85.2 a silent agent is cancelled and a fresh pass starts', () => {
  project()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p!.scriptAgent({ steps: [], roles: { ...judges(ALPHA_LINES), builder: [silent, finishing] } })
  const r = p!.werk(['build', '7', '--silence-limit', '5'])
  const lines = runRecord()
  expect(lines[0].agentCancelled).toBe('silence')
  expect(lines[1]?.ticket).toBe(7)
  expect(lines[1]?.pass).toBe(2)
  expect(lines[1]?.agentCancelled).toBe(null)
  const branch = branchOf(r.stdout)
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, T)

// 85.3
test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  project()
  const steps = []
  for (let i = 0; i < 40; i++) steps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, 'make: *** [check] Error 1'), { sleep: 50 })
  const looping: FakeReply = { steps: [...steps, { sleep: 10_000 }] }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p!.scriptAgent({ steps: [], roles: { ...judges(ALPHA_LINES), builder: [looping], 'loop-classifier': classifier } })
  p!.werk(['build', '7', '--cap', '1', '--loop-every', '5'])
  const [line] = runRecord()
  const acts = line.overseer.map((a: { act: string }) => a.act)
  expect(acts.filter((a: string) => a === 'warned')).toHaveLength(1)
  expect(acts).toEqual(['warned', 'cancelled'])
  expect(line.agentCancelled).toBe('loop')
  const builderInput = p!.agentInputs()[p!.agentRoles().indexOf('builder')]!.map((m) => JSON.stringify(m))
  expect(builderInput.some((m) => m.includes('werk overseer: you repeat the same steps'))).toBe(true)
}, T)

// 85.4
test('85.4 a long tool call in flight is not cancelled as silence', () => {
  project()
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 500 }, toolResult('t1'), ...finishing.steps] }
  p!.scriptAgent({ steps: [], roles: { ...judges(ALPHA_LINES), builder: [slowTool] } })
  const r = p!.werk(['build', '7', '--silence-limit', '5'])
  const lines = runRecord()
  expect(lines.every((l) => l.agentCancelled !== 'silence')).toBe(true)
  expect(lines).toHaveLength(1)
  const branch = branchOf(r.stdout)
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, T)
