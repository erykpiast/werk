/** Held-out steps 83.x (builder loop) and 84.x (grader and reviewers), run through `werk build`. */
import { expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { Event } from '../../src/map/events.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, linked, logOf, proposed } from '../../src/test/map-events.ts'

/** check passes when done.txt is there; otherwise it prints about 20,000 characters, ending in a mark. */
const MAKEFILE = [
  'check:',
  '\t@test -f done.txt || { head -c 20000 /dev/zero | tr "\\\\0" y; echo; echo "TAIL-OF-OUTPUT done.txt is missing"; exit 1; }',
  '',
].join('\n')

const baseTicket: TicketFields = {
  number: 3,
  title: 'The thing is done',
  cites: ['loop'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt holds the word done.',
  root: 'root',
}

function project(fields: Partial<TicketFields> = {}, mapEvents?: Event[]): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log =
    mapEvents ??
    logOf(
      proposed('root', { status: 'decided' }),
      proposed('loop', { status: 'decided', parent: 'root', title: 'Write the card by appending', body: 'Never write a card in place.' }),
      accepted('loop'),
    )
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: { ...baseTicket, ...fields } }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want done.txt.\n')
  return p
}

const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2 } })
const working: FakeReply = { steps: [{ edit: { path: 'work.txt', content: `started ${Math.random()}\n` } }, result(0.1)] }
const workingN = (n: number): FakeReply => ({ steps: [{ edit: { path: 'work.txt', content: `pass ${n}\n` } }, result(0.1)] })
const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }
const judgeReply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
const grading = (ids: string[], score: (id: string) => number, gap = (_id: string) => 'none') =>
  judgeReply({ lines: ids.map((id) => ({ id, score: score(id), gap: gap(id) })) })
const LINES = ['ac-1', 'ac-2', '#loop']
const judges = (ids = LINES): Record<string, FakeReply | FakeReply[]> => ({
  grader: grading(ids, () => 4),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])),
})

const git = (p: Project, ...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]
const runRecord = (p: Project) => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined)?.message.content ?? ''
const prompts = (p: Project, role = 'builder') => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === role ? [promptOf(lines)] : []))
}
const buildRoles = (p: Project) => p.agentRoles().filter((r) => !r?.startsWith('heldout-'))
const boardTicket = (p: Project) =>
  foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number, retries: t.retries })))
    .find((t) => t.number === 3)

test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  const p = project()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('green')
  const branch = branchOf(r.stdout)
  const subjects = git(p, 'log', '--format=%s', `main..${branch}`).split('\n')
  expect(subjects).toHaveLength(2)
  expect(subjects[1]).toContain('pass 1')
  expect(subjects[0]).toContain('pass 2')
  const lines = runRecord(p)
  expect(lines).toHaveLength(2)
  for (const l of lines) {
    expect(Array.isArray(l.checks)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks).toMatchObject([{ cmd: 'make check', ok: false }])
  expect(lines[1].checks).toMatchObject([{ cmd: 'make check', ok: true }])
}, 30_000)

test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  const p = project()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working, finishing] } })
  expect(p.werk(['build', '3']).code).toBe(0)
  const [first, second] = prompts(p)
  expect(second).toContain('make check')
  expect(second).toContain('TAIL-OF-OUTPUT done.txt is missing')
  const failure = second!.slice(second!.indexOf('## Last failure'))
  expect(failure.length).toBeLessThanOrEqual(4300)
  // The prompt as a whole holds no more than about 4,000 characters of the 20,000 y's.
  expect((second!.match(/y/g) ?? []).length).toBeLessThan(4300)
  expect(first).not.toContain('TAIL-OF-OUTPUT')
  expect(first).not.toContain('yyyyyyyyyy')
}, 30_000)

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  const p = project()
  writeFileSync(join(p.dir, 'tip.txt'), 'new tip\n')
  p.run(['git', 'add', 'tip.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git(p, 'rev-parse', 'main')
  writeFileSync(join(p.dir, 'tip.txt'), 'LOCAL-CHANGE\n')
  writeFileSync(join(p.dir, 'local.txt'), 'LOCAL-UNTRACKED\n')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  const firstPass = git(p, 'rev-list', '--reverse', `main..${branch}`).split('\n')[0]!
  expect(git(p, 'rev-parse', `${firstPass}^1`)).toBe(tip)
  expect(p.run(['git', 'grep', '-q', 'LOCAL-', branch]).code).toBe(1)
  expect(git(p, 'log', '--format=%H', `main..${branch}`, '--', 'local.txt')).toBe('')
  expect(readFileSync(join(p.dir, 'tip.txt'), 'utf8')).toBe('LOCAL-CHANGE\n')
  expect(readFileSync(join(p.dir, 'local.txt'), 'utf8')).toBe('LOCAL-UNTRACKED\n')
}, 30_000)

test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  const p = project()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [workingN(1), workingN(2), workingN(3), workingN(4), workingN(5)] } })
  const r = p.werk(['build', '3'])
  expect(r.code).not.toBe(0)
  const branch = branchOf(r.stdout)
  expect(git(p, 'branch', '--list', branch)).toContain(branch)
  expect(git(p, 'rev-list', '--count', `main..${branch}`)).toBe('5')
  const lines = runRecord(p)
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.green).toBe(false)
    expect(l.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
}, 60_000)

test('83.5 the board shows the ticket in building with its retry count', async () => {
  const p = project()
  expect(boardTicket(p)?.column).toBe('ready')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [workingN(1), { steps: [{ sleep: 1500 }, ...workingN(2).steps] }, finishing] } })
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts'), 'build', '3'], {
    cwd: p.dir,
    env: p.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let seenBuilding = false
  for (const end = Date.now() + 20_000; Date.now() < end && child.exitCode === null; await Bun.sleep(50)) {
    if (boardTicket(p)?.column === 'building') seenBuilding = true
  }
  await child.exited
  expect(seenBuilding).toBe(true)
  expect(boardTicket(p)).toMatchObject({ column: 'building', retries: 2 })
}, 30_000)

const failingGrade = (ids: string[]) =>
  grading(
    ids,
    (id) => (id === '#loop' ? 2 : 4),
    (id) => (id === '#loop' ? 'the diff writes the card in place, the card forbids it (done.txt:1)' : 'none'),
  )

test('84.1 a grader score of 2 fails the pass and the gap reaches the next pass', () => {
  const p = project()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing], grader: [failingGrade(LINES), grading(LINES, () => 4)] } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the grader')
  const roles = buildRoles(p)
  // No reviewer between the first grader and the second builder.
  const secondBuilder = roles.indexOf('builder', roles.indexOf('builder') + 1)
  expect(secondBuilder).toBeGreaterThan(0)
  expect(roles.slice(0, secondBuilder).some((x) => x?.startsWith('reviewer-'))).toBe(false)
  const second = prompts(p)[1]!
  expect(second).toContain('the diff writes the card in place, the card forbids it')
  expect(second).toContain('done.txt:1')
}, 30_000)

test('84.2 the grader judges every decided card in the depends_on closure, cited or not', () => {
  const log = logOf(
    proposed('root', { status: 'decided' }),
    proposed('loop', { status: 'decided', parent: 'root', title: 'CITED-CARD title' }),
    proposed('second', { status: 'decided', parent: 'root', title: 'UNCITED-DECIDED title' }),
    proposed('third', { status: 'open', parent: 'root', title: 'OPEN-CARD title' }),
    accepted('loop'),
    accepted('second'),
    accepted('third'),
    linked('loop', 'second', 'depends_on'),
    linked('second', 'third', 'depends_on'),
  )
  const brief =
    '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- CRIT-ONE done.txt is there.\n- CRIT-TWO it says done.\n- CRIT-THREE it ends in a newline.'
  const p = project({ brief }, log)
  p.scriptAgent({ steps: [], roles: { ...judges(['ac-1', 'ac-2', 'ac-3', '#loop', '#second']), builder: [finishing] } })
  p.werk(['build', '3'])
  const [grader] = prompts(p, 'grader')
  expect(grader).toBeDefined()
  const delivery = grader!.split('\n').filter((l) => /\(delivery\)/.test(l))
  expect(delivery).toHaveLength(3)
  expect(grader).toContain('CRIT-ONE')
  expect(grader).toContain('CRIT-TWO')
  expect(grader).toContain('CRIT-THREE')
  const contradiction = grader!.split('\n').filter((l) => /\(contradiction\)/.test(l))
  expect(contradiction).toHaveLength(2)
  expect(grader).toContain('CITED-CARD title')
  expect(grader).toContain('UNCITED-DECIDED title')
  expect(grader).not.toContain('OPEN-CARD')
  expect(grader).toContain('A part of a card that the diff does not build yet passes its contradiction line')
}, 30_000)

test('84.3 an unbuilt part of a card passes its line and the pass goes on to the review', () => {
  const log = logOf(
    proposed('root', { status: 'decided' }),
    proposed('loop', { status: 'decided', parent: 'root', title: 'CARD-TITLE two parts', body: 'Part one: done.txt. Part two: a retry cap.' }),
    accepted('loop'),
  )
  const p = project({}, log)
  const grade = grading(
    LINES,
    (id) => (id === '#loop' ? 3 : 4),
    (id) => (id === '#loop' ? 'not built yet: part two, the retry cap' : 'none'),
  )
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing], grader: grade } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).not.toContain('red at the grader')
  const reviewers = buildRoles(p).filter((x) => x?.startsWith('reviewer-'))
  expect(reviewers.toSorted()).toEqual(REVIEWERS.toSorted())
  for (const [i, area] of ['design', 'maintainability', 'tests', 'security and dependencies', 'performance'].entries()) {
    const [prompt] = prompts(p, REVIEWERS[i])
    expect(prompt).toContain(`${area} reviewer`)
    expect(prompt).toContain('+done')
    // The diff only: no card and no ticket brief.
    expect(prompt).not.toContain('CARD-TITLE')
    expect(prompt).not.toContain('Make done.txt.')
  }
}, 30_000)

test('84.4 a HIGH review finding fails the pass and goes into the next prompt', () => {
  const p = project()
  const high = { severity: 'HIGH', file: 'done.txt', line: 1, impact: 'the token is written to the log', fix: 'redact the token' }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing], 'reviewer-security': [reviewing([high]), reviewing()] } })
  const r = p.werk(['build', '3'])
  expect(r.stdout).toContain('pass 1: red at the review')
  const second = prompts(p)[1]!
  expect(second).toContain('HIGH')
  expect(second).toContain('done.txt:1')
  expect(second).toContain('the token is written to the log')
  expect(second).toContain('redact the token')
  const lines = runRecord(p)
  expect(lines).toHaveLength(2)
  expect(lines[1].checks.length).toBeGreaterThan(0)
  expect(prompts(p, 'grader')).toHaveLength(2)
  for (const rv of REVIEWERS) expect(prompts(p, rv)).toHaveLength(2)
}, 30_000)

test('84.5 only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  const p = project()
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 2, impact: 'no newline', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: { ...judges(), builder: [finishing], 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]) },
  })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(prompts(p)).toHaveLength(1)
  const [line] = runRecord(p)
  expect(line.green).toBe(true)
  expect(line.review.findings).toEqual([
    { area: 'maintainability', ...medium },
    { area: 'tests', ...low },
  ])
  expect(boardTicket(p)?.column).not.toBe('building')
}, 30_000)

test('84.5 (variant through the merge loop) the ticket leaves building after a green pass with MEDIUM and LOW findings', () => {
  const p = project()
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 2, impact: 'no newline', fix: 'add one' }
  const step = judgeReply({ steps: [{ text: 'Given x\nWhen y\nThen z' }] })
  p.scriptAgent({
    steps: [],
    roles: {
      ...judges(),
      builder: [finishing],
      'reviewer-maintainability': reviewing([medium]),
      'reviewer-tests': reviewing([low]),
      'heldout-author': step,
      'heldout-binder': judgeReply({ steps: [{ id: '3.1', cmd: 'true' }] }),
    },
  })
  p.werk(['run', 'root'])
  expect(prompts(p)).toHaveLength(1)
  expect(boardTicket(p)?.column).not.toBe('building')
}, 60_000)
