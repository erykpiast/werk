/** Held-out steps 83.1–85.4: the build verb, run as a process with the fake agent. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, linked, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

const MAKEFILE = (body: string) => `check:\n${body}\n`
/** One check command: green when done.txt is there. */
const SIMPLE_CHECK = '\t@test -f done.txt || { echo "done.txt is missing"; exit 1; }'
/** A check that prints about 20,000 characters, then fails, when done.txt is missing. */
const LONG_CHECK = '\t@test -f done.txt || { head -c 20000 /dev/zero | tr "\\\\0" y; echo; echo "TAIL-OF-OUTPUT"; exit 1; }'

const baseTicket: TicketFields = {
  number: 1,
  title: 'Make done',
  cites: ['card-a'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt holds done.',
  root: 'root',
}

type Setup = { ticket?: Partial<TicketFields>; check?: string; mapEvents?: Parameters<typeof logOf> }

function project(s: Setup = {}): Project {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE(s.check ?? SIMPLE_CHECK))
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const events = s.mapEvents ?? [
    proposed('root', { status: 'decided' }),
    proposed('card-a', { status: 'decided', parent: 'root', title: 'Card A never writes in place', body: 'Never edit a card in place.' }),
    accepted('card-a'),
  ]
  writeFileSync(join(werk, 'log.jsonl'), logOf(...events).map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: { ...baseTicket, ...s.ticket } }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want done.txt.\n')
  return p
}

const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1 } })
const red: FakeReply = { steps: [{ edit: { path: 'work.txt', content: `w${Math.random()}\n` } }, result(0.1)] }
const green: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }
const judgeReply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
const gradeAll = (ids: string[], score = 4, gap = (_: string) => 'none') => judgeReply({ lines: ids.map((id) => ({ id, score, gap: gap(id) })) })
const LINES = ['ac-1', 'ac-2', '#card-a']
const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
const judges = (): Record<string, FakeReply | FakeReply[]> => ({
  grader: gradeAll(LINES),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])),
})

const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]
const runRecord = () => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const boardTicket = () =>
  foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number, retries: t.retries })))
    .find((t) => t.number === 1)
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content ?? ''
const launchesOf = (role: string) => {
  const roles = p.agentRoles()
  const inputs = p.agentInputs()
  return p.agentLaunches().flatMap((argv, i) => (roles[i] === role ? [{ argv, prompt: promptOf(inputs[i]!) }] : []))
}
const prompts = (role = 'builder') => launchesOf(role).map((l) => l.prompt)
const buildRoles = () => p.agentRoles().filter((r) => !r?.startsWith('heldout-') && r !== 'loop-classifier')
const lastFailure = (prompt: string) => prompt.slice(prompt.indexOf('## Last failure\n\n') + '## Last failure\n\n'.length)

// 83.1
test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  project()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [red, green] } })
  const r = p.werk(['build', '1'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  expect(git('log', '--format=%s', `main..${branch}`).split('\n')).toEqual(['werk build 1: pass 2', 'werk build 1: pass 1'])
  const lines = runRecord()
  expect(lines).toHaveLength(2)
  for (const l of lines) {
    expect(l.checks.length).toBeGreaterThan(0)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks[0].ok).toBe(false)
  expect(lines[1].checks[0].ok).toBe(true)
})

// 83.2
test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  project({ check: LONG_CHECK })
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [red, green] } })
  expect(p.werk(['build', '1']).code).toBe(0)
  const [first, second] = prompts()
  expect(second).toContain('make check')
  const failure = lastFailure(second!)
  expect(failure).toContain('Command: make check')
  expect(failure).toContain('TAIL-OF-OUTPUT')
  expect(failure.length).toBeLessThanOrEqual(4200)
  expect(lastFailure(first!)).toBe('Nothing has failed yet.')
  expect(first).not.toContain('TAIL-OF-OUTPUT')
})

// 83.3
test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  project()
  p.run(['git', 'commit', '--quiet', '--allow-empty', '-m', 'A new tip'])
  const tip = git('rev-parse', 'main')
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE(SIMPLE_CHECK) + '# local change\n')
  writeFileSync(join(p.dir, 'local.txt'), 'local\n')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [green] } })
  const r = p.werk(['build', '1'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  const firstPass = git('rev-list', '--reverse', `main..${branch}`).split('\n')[0]!
  expect(git('rev-parse', `${firstPass}^1`)).toBe(tip)
  for (const c of git('rev-list', `main..${branch}`).split('\n')) {
    expect(git('show', `${c}:Makefile`)).not.toContain('# local change')
    expect(git('ls-tree', '--name-only', c).split('\n')).not.toContain('local.txt')
  }
  expect(readFileSync(join(p.dir, 'Makefile'), 'utf8')).toContain('# local change')
  expect(readFileSync(join(p.dir, 'local.txt'), 'utf8')).toBe('local\n')
})

// 83.4
test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  project()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [red] } })
  const r = p.werk(['build', '1'])
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
})

// 83.5
test('83.5 the board shows the ticket in building with its retry count', () => {
  project()
  expect(boardTicket()?.column).toBe('ready')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [red, red, green] } })
  expect(p.werk(['build', '1']).code).toBe(0)
  expect(boardTicket()).toEqual({ column: 'building', number: 1, retries: 2 })
})

// 84.1
test('84.1 a grader score of 2 fails the pass and the gap reaches the next pass', () => {
  project()
  const GAP = 'done.txt:1 the diff writes the card in place, the card forbids it'
  const failing = gradeAll(LINES, 4, () => 'none')
  ;(failing.steps[0] as { event: { result: string } }).event.result = `Done.\n${JSON.stringify({
    lines: LINES.map((id) => ({ id, score: id === '#card-a' ? 2 : 4, gap: id === '#card-a' ? GAP : 'none' })),
  })}`
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [green], grader: [failing, gradeAll(LINES)] } })
  const r = p.werk(['build', '1'])
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = buildRoles()
  const secondBuilder = roles.indexOf('builder', 1)
  expect(secondBuilder).toBeGreaterThan(0)
  expect(roles.slice(0, secondBuilder).some((x) => x?.startsWith('reviewer-'))).toBe(false)
  expect(prompts()[1]).toContain('the diff writes the card in place, the card forbids it')
  expect(prompts()[1]).toContain('done.txt:1')
})

// 84.2
test('84.2 the grader judges every decided card in the depends_on closure, cited or not', () => {
  project({
    ticket: { brief: '## What to build\n\nX.\n\n## Acceptance criteria\n\n- one\n- two\n- three' },
    mapEvents: [
      proposed('root', { status: 'decided' }),
      proposed('card-a', { status: 'decided', parent: 'root', title: 'Cited card' }),
      proposed('card-b', { status: 'decided', title: 'Uncited decided card' }),
      proposed('card-c', { status: 'open', title: 'Open third card' }),
      accepted('card-a'),
      accepted('card-b'),
      accepted('card-c'),
      linked('card-a', 'card-b', 'depends_on'),
      linked('card-b', 'card-c', 'depends_on'),
    ],
  })
  p.scriptAgent({ steps: [], roles: { ...judges(), grader: gradeAll(['ac-1', 'ac-2', 'ac-3', '#card-a', '#card-b']), builder: [green] } })
  expect(p.werk(['build', '1']).code).toBe(0)
  const [grader] = prompts('grader')
  const lineSection = grader!.slice(grader!.indexOf('## Lines'), grader!.indexOf('## Ticket'))
  expect(lineSection.match(/\(delivery\)/g)).toHaveLength(3)
  expect(lineSection).toContain('#card-a (contradiction)')
  expect(lineSection).toContain('#card-b (contradiction)')
  expect(lineSection).not.toContain('card-c')
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
})

// 84.3
test('84.3 an unbuilt part of a card passes its line and the pass goes on to the review', () => {
  project({
    ticket: { brief: '## What to build\n\nPart one of card A.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt holds done.' },
    mapEvents: [
      proposed('root', { status: 'decided' }),
      proposed('card-a', { status: 'decided', parent: 'root', title: 'Two parts', body: 'Part one: done.txt. Part two: SECRET-PART-TWO.' }),
      accepted('card-a'),
    ],
  })
  const unbuilt = gradeAll(LINES, 4, (id) => (id === '#card-a' ? 'not built yet: part two' : 'none'))
  ;(unbuilt.steps[0] as { event: { result: string } }).event.result = `Done.\n${JSON.stringify({
    lines: LINES.map((id) => ({ id, score: id === '#card-a' ? 3 : 4, gap: id === '#card-a' ? 'not built yet: part two' : 'none' })),
  })}`
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [green], grader: unbuilt } })
  const r = p.werk(['build', '1'])
  expect(r.stdout).not.toContain('red at the grader')
  const reviewers = buildRoles().filter((x) => x?.startsWith('reviewer-'))
  expect(reviewers.toSorted()).toEqual(REVIEWERS.toSorted())
  for (const role of REVIEWERS) {
    const [prompt] = prompts(role)
    expect(prompt).toContain('+done')
    expect(prompt).not.toContain('SECRET-PART-TWO')
    expect(prompt).not.toContain('Part one of card A')
  }
})

// 84.4
test('84.4 a HIGH review finding fails the pass and goes into the next prompt', () => {
  project()
  const high = { severity: 'HIGH', file: 'done.txt', line: 1, impact: 'the token is written to the log', fix: 'redact the token' }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [green], 'reviewer-security': [reviewing([high]), reviewing()] } })
  const r = p.werk(['build', '1'])
  expect(r.stdout).toContain('pass 1: red at the review')
  expect(prompts()).toHaveLength(2)
  const failure = lastFailure(prompts()[1]!)
  expect(failure).toContain('HIGH')
  expect(failure).toContain('done.txt:1')
  expect(failure).toContain('the token is written to the log')
  expect(failure).toContain('redact the token')
  const lines = runRecord()
  expect(lines[1].checks.length).toBeGreaterThan(0)
  expect(lines[1].grade).toBeDefined()
  expect(prompts('grader')).toHaveLength(2)
  for (const role of REVIEWERS) expect(prompts(role)).toHaveLength(2)
})

// 84.5
test('84.5 only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  project()
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 1, impact: 'no newline', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [green], 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]) },
  })
  const r = p.werk(['build', '1'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('pass 1: green')
  expect(prompts()).toHaveLength(1)
  const [line] = runRecord()
  expect(line.review.findings).toEqual(
    expect.arrayContaining([expect.objectContaining(medium), expect.objectContaining(low)]),
  )
  expect(boardTicket()?.column).not.toBe('building')
})

// 85.x: the overseer
const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string) => ({ event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } } })

test('85.1 an unanswered permission ask gets an answer and the build continues', () => {
  project()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...green.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [asking] } })
  const r = p.werk(['build', '1'])
  expect(runRecord()[0].overseer).toContainEqual(expect.objectContaining({ act: 'answered', requestId: 'ask-1' }))
  const builderIndex = p.agentRoles().indexOf('builder')
  expect(p.agentInputs()[builderIndex]).toContainEqual(
    expect.objectContaining({ type: 'control_response', response: expect.objectContaining({ request_id: 'ask-1' }) }),
  )
  expect(runRecord()[0].agentExit).toBe(0)
  const branch = branchOf(r.stdout)
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
})

test('85.2 a silent agent is cancelled and a fresh pass starts', () => {
  project()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [silent, green] } })
  // "a few milliseconds"
  const r = p.werk(['build', '1', '--silence-limit', '10'])
  const lines = runRecord()
  expect(lines[0].agentCancelled).toBe('silence')
  expect(lines.length).toBeGreaterThanOrEqual(2)
  expect(lines[1].ticket).toBe(1)
  const branch = branchOf(r.stdout)
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 20_000)

test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  project()
  const looping: FakeReply = {
    steps: [toolUse('t1', 'make check'), toolResult('t1'), toolUse('t2', 'make check'), toolResult('t2'), toolUse('t3', 'make check'), toolResult('t3'), { sleep: 10_000 }],
  }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [looping], 'loop-classifier': classifier } })
  // "a few milliseconds"
  p.werk(['build', '1', '--cap', '1', '--loop-every', '10'])
  const acts = runRecord()[0].overseer.map((a: { act: string; reason?: string }) => a.act + (a.reason ? `:${a.reason}` : ''))
  expect(acts.filter((a: string) => a === 'warned')).toHaveLength(1)
  const warnAt = acts.indexOf('warned')
  const cancelAt = acts.indexOf('cancelled:loop')
  expect(cancelAt).toBeGreaterThan(warnAt)
  expect(acts.slice(0, warnAt).some((a: string) => a.startsWith('cancelled'))).toBe(false)
  const builderIndex = p.agentRoles().indexOf('builder')
  expect(p.agentInputs()[builderIndex]!.some((m) => JSON.stringify(m).includes('werk overseer'))).toBe(true)
}, 20_000)

test('85.4 a long tool call in flight is not cancelled as silence', () => {
  project()
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 500 }, toolResult('t1'), ...green.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [slowTool] } })
  // "a few milliseconds"; the tool call runs fifty limits long
  const r = p.werk(['build', '1', '--silence-limit', '10'])
  const lines = runRecord()
  expect(lines.some((l) => l.agentCancelled === 'silence')).toBe(false)
  expect(lines).toHaveLength(1)
  expect(git('show', `${branchOf(r.stdout)}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 20_000)
