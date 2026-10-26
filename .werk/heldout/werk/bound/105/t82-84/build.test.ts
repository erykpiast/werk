/** Held-out steps 83.x and 84.x: the build loop, the grader and the review, with a fake builder. */
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

/** The check passes when done.txt is there. Otherwise it prints about 20,000 characters, ends with a mark, and fails. */
const MAKEFILE = [
  'check:',
  '\t@test -f done.txt || { head -c 20000 /dev/zero | tr "\\\\0" y; echo; echo "TAIL-OF-THE-OUTPUT done.txt is missing"; exit 1; }',
  '',
].join('\n')

const base: TicketFields = {
  number: 7,
  title: 'Write the done file',
  cites: ['cited'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt holds a line.',
  root: 'root',
}

type Setup = { fields?: Partial<TicketFields>; cards?: Parameters<typeof logOf> }

function project({ fields = {}, cards }: Setup = {}): Project {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(
    ...(cards ?? [
      proposed('root', { status: 'decided' }),
      proposed('cited', { status: 'decided', parent: 'root', title: 'Cards are append only', body: 'A card is never written in place.' }),
      accepted('cited'),
    ]),
  )
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: { ...base, ...fields } }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want done.txt.\n')
  return p
}

const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 2 } })
const red: FakeReply = { steps: [{ edit: { path: 'work.txt', content: 'started\n' } }, result(0.1)] }
const green: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }

const judgeReply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})
const lineIds = (prompt: string) => [...prompt.matchAll(/^- (ac-\d+|#[\w-]+) \((delivery|contradiction)\)/gm)].map((m) => m[1]!)
const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
const reviewing = (findings: unknown[] = []) => judgeReply({ findings })
const gradeAll = (ids: string[], score = 4, gap: (id: string) => string = () => 'none') =>
  judgeReply({ lines: ids.map((id) => ({ id, score: id === '' ? 0 : score, gap: gap(id) })) })
const quietReviewers = () => Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()]))

const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]
const runRecord = () => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) => {
  const user = lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } } | undefined
  return user?.message.content
}
/** The prompt of every launch of a role: the first user message on stdin, or the -p argument. */
const prompts = (role: string) => {
  const roles = p.agentRoles()
  const argvs = p.agentLaunches()
  return p.agentInputs().flatMap((lines, i) => {
    if (roles[i] !== role) return []
    const argv = argvs[i]!
    return [promptOf(lines) ?? argv[argv.indexOf('-p') + 1] ?? argv.join(' ')]
  })
}
const roles = () => p.agentRoles().filter((r) => !r?.startsWith('heldout-'))

// ---------- 83 ----------

test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  project()
  p.scriptAgent({ steps: [], roles: { grader: gradeAll(['ac-1', 'ac-2', '#cited']), ...quietReviewers(), builder: [red, green] } })
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  expect(r.stdout).toMatch(/green/)
  const branch = branchOf(r.stdout)
  const subjects = git('log', '--format=%s', `main..${branch}`).split('\n')
  expect(subjects).toHaveLength(2)
  expect(subjects[1]).toContain('pass 1')
  expect(subjects[0]).toContain('pass 2')
  const lines = runRecord()
  expect(lines).toHaveLength(2)
  for (const l of lines) {
    expect(Array.isArray(l.checks)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks[0]).toMatchObject({ cmd: 'make check', ok: false })
  expect(lines[1].checks[0]).toMatchObject({ cmd: 'make check', ok: true })
}, 60_000)

test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  project()
  p.scriptAgent({ steps: [], roles: { grader: gradeAll(['ac-1', 'ac-2', '#cited']), ...quietReviewers(), builder: [red, green] } })
  expect(p.werk(['build', '7']).code).toBe(0)
  const [first, second] = prompts('builder')
  expect(second).toContain('make check')
  expect(second).toContain('TAIL-OF-THE-OUTPUT done.txt is missing')
  const failure = second!.slice(second!.indexOf('## Last failure'))
  expect(failure.length).toBeLessThanOrEqual(4300)
  expect(first).not.toContain('TAIL-OF-THE-OUTPUT')
  expect(first).not.toContain('yyyyyyyyyy')
  expect(first).not.toContain('Exit code')
}, 60_000)

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  project()
  writeFileSync(join(p.dir, 'notes.txt'), 'committed\n')
  p.run(['git', 'add', 'notes.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git('rev-parse', 'main')
  writeFileSync(join(p.dir, 'notes.txt'), 'LOCAL-CHANGE not committed\n')
  writeFileSync(join(p.dir, 'local.txt'), 'LOCAL-FILE not committed\n')
  p.scriptAgent({ steps: [], roles: { grader: gradeAll(['ac-1', 'ac-2', '#cited']), ...quietReviewers(), builder: [green] } })
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  const commits = git('rev-list', '--reverse', `main..${branch}`).split('\n')
  expect(git('rev-parse', `${commits[0]}^1`)).toBe(tip)
  for (const c of commits) {
    expect(git('show', `${c}:notes.txt`)).toBe('committed')
    expect(git('ls-tree', '--name-only', c).split('\n')).not.toContain('local.txt')
  }
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('LOCAL-CHANGE not committed\n')
  expect(readFileSync(join(p.dir, 'local.txt'), 'utf8')).toBe('LOCAL-FILE not committed\n')
}, 60_000)

test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  project()
  p.scriptAgent({ steps: [], roles: { grader: gradeAll(['ac-1', 'ac-2', '#cited']), ...quietReviewers(), builder: [red] } })
  const r = p.werk(['build', '7'])
  expect(r.code).not.toBe(0)
  expect(roles().filter((x) => x === 'builder')).toHaveLength(5)
  const branch = branchOf(r.stdout)
  expect(git('branch', '--list', branch)).toContain(branch)
  expect(git('rev-list', '--count', `main..${branch}`)).toBe('5')
  const lines = runRecord()
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
}, 120_000)

test('83.5 the board shows the ticket in building with its retry count', async () => {
  project()
  const before = foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
  expect(before.columns.find((c) => c.name === 'ready')!.tickets.map((t) => t.number)).toContain(7)
  p.scriptAgent({ steps: [], roles: { grader: gradeAll(['ac-1', 'ac-2', '#cited']), ...quietReviewers(), builder: [red, red, green] } })
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts'), 'build', '7'], {
    cwd: p.dir,
    env: p.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const column = () =>
    foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))).columns.find((c) => c.tickets.some((t) => t.number === 7))?.name
  let sawBuilding = false
  while (child.exitCode === null) {
    if (column() === 'building') sawBuilding = true
    await Bun.sleep(50)
  }
  await child.exited
  expect(sawBuilding).toBe(true)
  const t = foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((x) => ({ column: c.name, ...x })))
    .find((x) => x.number === 7)!
  expect(t.retries).toBe(2)
}, 120_000)

// ---------- 84 ----------

const GAP = 'the diff writes the card in place, the card forbids it'

test('84.1 a grader score of 2 fails the pass and the gap reaches the next pass', () => {
  project()
  const ids = ['ac-1', 'ac-2', '#cited']
  const failing = gradeAll(ids, 4, () => 'none')
  ;(failing.steps[0] as { event: { result: string } }).event.result = `Done.\n${JSON.stringify({
    lines: ids.map((id) => (id === '#cited' ? { id, score: 2, gap: `${GAP} (done.txt:1)` } : { id, score: 4, gap: 'none' })),
  })}`
  p.scriptAgent({ steps: [], roles: { ...quietReviewers(), builder: [green], grader: [failing, gradeAll(ids)] } })
  const r = p.werk(['build', '7'])
  const order = roles()
  // the first pass: builder, grader, then no reviewer before the second builder
  expect(order.slice(0, 3)).toEqual(['builder', 'grader', 'builder'])
  expect(r.stdout).toMatch(/pass 1: red at the grader/)
  expect(runRecord()[0].review).toBeUndefined()
  const second = prompts('builder')[1]!
  expect(second).toContain(GAP)
  expect(second).toContain('done.txt:1')
}, 60_000)

test('84.2 the grader judges every decided card in the depends_on closure, cited or not', () => {
  project({
    fields: { brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.\n- done.txt holds a line.\n- the check is green.' },
    cards: [
      proposed('root', { status: 'decided' }),
      proposed('cited', { status: 'decided', parent: 'root', title: 'Cards are append only' }),
      proposed('second', { status: 'decided', parent: 'root', title: 'UNCITED-DECIDED card' }),
      proposed('third', { status: 'open', parent: 'root', title: 'OPEN-THIRD card' }),
      accepted('cited'),
      accepted('second'),
      accepted('third'),
      linked('cited', 'second', 'depends_on'),
      linked('second', 'third', 'depends_on'),
    ],
  })
  p.scriptAgent({ steps: [], roles: { grader: gradeAll(['ac-1', 'ac-2', 'ac-3', '#cited', '#second']), ...quietReviewers(), builder: [green] } })
  p.werk(['build', '7'])
  const [grader] = prompts('grader')
  expect(grader).toBeDefined()
  const ids = lineIds(grader!)
  expect(ids.filter((i) => i.startsWith('ac-'))).toEqual(['ac-1', 'ac-2', 'ac-3'])
  expect(ids.filter((i) => i.startsWith('#')).toSorted()).toEqual(['#cited', '#second'])
  expect(grader).not.toContain('OPEN-THIRD')
  expect(grader).toMatch(/part of a card that the diff does not build yet passes its contradiction line/)
}, 60_000)

test('84.3 an unbuilt part of a card passes its line and the pass goes on to the review', () => {
  project({
    cards: [
      proposed('root', { status: 'decided' }),
      proposed('cited', { status: 'decided', parent: 'root', title: 'Cards are append only', body: 'Part one: the done file. Part two: the retry cap.' }),
      accepted('cited'),
    ],
  })
  const ids = ['ac-1', 'ac-2', '#cited']
  p.scriptAgent({
    steps: [],
    roles: { grader: gradeAll(ids, 3, (id) => (id === '#cited' ? 'not built yet: part two, the retry cap' : 'none')), ...quietReviewers(), builder: [green] },
  })
  const r = p.werk(['build', '7'])
  expect(r.stdout).not.toMatch(/red at the grader/)
  const reviewers = roles().filter((x) => x?.startsWith('reviewer-'))
  expect(reviewers.toSorted()).toEqual(REVIEWERS.toSorted())
  const areas = ['design', 'maintainability', 'tests', 'security and dependencies', 'performance']
  for (const [i, role] of REVIEWERS.entries()) {
    const [prompt] = prompts(role)
    expect(prompt).toContain(`You are the ${areas[i]} reviewer`)
    expect(prompt).toContain('+done')
    expect(prompt).not.toContain('Cards are append only')
    expect(prompt).not.toContain('Make done.txt.')
  }
}, 60_000)

test('84.4 a HIGH review finding fails the pass and goes into the next prompt', () => {
  project()
  const ids = ['ac-1', 'ac-2', '#cited']
  const high = { severity: 'HIGH', file: 'done.txt', line: 1, impact: 'the token is written to the log', fix: 'redact the token before the write' }
  p.scriptAgent({
    steps: [],
    roles: { grader: gradeAll(ids), ...quietReviewers(), 'reviewer-security': [reviewing([high]), reviewing()], builder: [green] },
  })
  const r = p.werk(['build', '7'])
  expect(r.stdout).toMatch(/pass 1: red at the review/)
  const builders = prompts('builder')
  expect(builders.length).toBeGreaterThanOrEqual(2)
  const second = builders[1]!
  expect(second).toContain('HIGH')
  expect(second).toContain('done.txt:1')
  expect(second).toContain('the token is written to the log')
  expect(second).toContain('redact the token before the write')
  const record = runRecord()
  expect(record.length).toBeGreaterThanOrEqual(2)
  expect(record[1].checks.length).toBeGreaterThan(0)
  expect(record[1].grade).toBeDefined()
  const order = roles()
  const secondBuilder = order.indexOf('builder', 1)
  const after = order.slice(secondBuilder + 1)
  expect(after).toContain('grader')
  expect(after.filter((x) => x?.startsWith('reviewer-')).toSorted()).toEqual(REVIEWERS.toSorted())
}, 60_000)

test('84.5 only MEDIUM and LOW findings let the pass go green and the run record keeps them', () => {
  project()
  const ids = ['ac-1', 'ac-2', '#cited']
  const medium = { severity: 'MEDIUM', file: 'done.txt', line: 1, impact: 'a vague name', fix: 'rename it' }
  const low = { severity: 'LOW', file: 'done.txt', line: 1, impact: 'no newline at the end', fix: 'add one' }
  p.scriptAgent({
    steps: [],
    roles: { grader: gradeAll(ids), ...quietReviewers(), 'reviewer-maintainability': reviewing([medium]), 'reviewer-tests': reviewing([low]), builder: [green] },
  })
  // The person starts the build through the merge loop, the path that moves a green ticket on.
  const r = p.werk(['run', 'root', '--poll-every', '50'])
  expect(r.stdout).toContain('pass 1: green')
  expect(roles().filter((x) => x === 'builder')).toHaveLength(1)
  const col = foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))).columns.find((c) => c.tickets.some((t) => t.number === 7))?.name
  expect(col).not.toBe('building')
  const [line] = runRecord()
  expect(line.review.findings).toEqual(expect.arrayContaining([expect.objectContaining(medium), expect.objectContaining(low)]))
}, 60_000)
