/** Held-out steps 83.1-83.5: the build verb, run as a process with a fake builder. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

/** The check passes when ok.txt is there; else it prints about 20,000 characters, then a mark, and fails. */
const MAKEFILE = [
  'check:',
  '\t@test -f ok.txt || { head -c 20000 /dev/zero | tr "\\\\0" y; echo; echo "ok.txt is missing TAIL-MARK"; exit 1; }',
  '',
].join('\n')

const ticket: TicketFields = {
  number: 7,
  title: 'The ok file exists',
  cites: ['core'],
  blockedBy: [],
  stories: [1],
  touches: ['core module'],
  checks: ['make check'],
  brief: '## What to build\n\nMake ok.txt.\n\n## Acceptance criteria\n\n- ok.txt is there.',
  root: 'root',
}

function project(): Project {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE)
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), accepted('root'), proposed('core', { status: 'decided', parent: 'root' }), accepted('core'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: ticket }]
  writeFileSync(join(werk, 'board.jsonl'), board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n')
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a person, I want ok.txt.\n')
  return p
}

const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1 } })
const red = (n: number): FakeReply => ({ steps: [{ edit: { path: `work${n}.txt`, content: `try ${n}\n` } }, result(0.1)] })
const green: FakeReply = { steps: [{ edit: { path: 'ok.txt', content: 'ok\n' } }, result(0.3)] }
const judgeReply = (o: unknown): FakeReply => ({ steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: JSON.stringify(o) } }] })
const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
const judges = () => ({
  grader: judgeReply({ lines: ['ac-1', '#core', '#root'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, judgeReply({ findings: [] })])),
})

const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)?.[0] ?? ''
const boardTicket = () =>
  foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, retries: t.retries, number: t.number })))
    .find((t) => t.number === 7)
const runRecord = () => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) => (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } }).message.content
const builderPrompts = () => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === 'builder' ? [promptOf(lines)] : []))
}

test('83.1 a ticket red once is green on the second pass, with two pass commits and two run lines', () => {
  project()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [red(1), green] } })
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  expect(r.stdout).toMatch(/green/)
  const branch = branchOf(r.stdout)
  expect(git('log', '--format=%s', `main..${branch}`).split('\n').map((s) => /pass \d+$/.exec(s)?.[0])).toEqual(['pass 2', 'pass 1'])
  const lines = runRecord()
  expect(lines).toHaveLength(2)
  for (const l of lines) {
    expect(l.checks.length).toBeGreaterThan(0)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks[0].ok).toBe(false)
  expect(lines[1].checks[0].ok).toBe(true)
}, 120_000)

test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  project()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [red(1), green] } })
  expect(p.werk(['build', '7']).code).toBe(0)
  const [first, second] = builderPrompts()
  expect(second).toContain('make check')
  expect(second).toContain('ok.txt is missing TAIL-MARK')
  // The failure text: from the failed command to the end of the prompt section.
  const from = second!.indexOf('Command: make check')
  expect(from).toBeGreaterThanOrEqual(0)
  const failure = second!.slice(from)
  expect(failure.length).toBeLessThanOrEqual(4200)
  expect(first).not.toContain('TAIL-MARK')
  expect(first).not.toContain('Command: make check')
}, 120_000)

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  project()
  writeFileSync(join(p.dir, 'tip.txt'), 'tip\n')
  p.run(['git', 'add', 'tip.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new tip'])
  const tip = git('rev-parse', 'main')
  writeFileSync(join(p.dir, 'local.txt'), 'local change\n')
  writeFileSync(join(p.dir, 'Makefile'), MAKEFILE + '# local edit\n')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [green] } })
  const r = p.werk(['build', '7'])
  const branch = branchOf(r.stdout)
  const first = git('rev-list', '--reverse', `main..${branch}`).split('\n')[0]!
  expect(git('rev-parse', `${first}^1`)).toBe(tip)
  for (const c of git('rev-list', `main..${branch}`).split('\n')) {
    expect(git('show', '--name-only', '--format=', c).split('\n')).not.toContain('local.txt')
    expect(git('show', `${c}:Makefile`)).not.toContain('# local edit')
  }
  expect(readFileSync(join(p.dir, 'local.txt'), 'utf8')).toBe('local change\n')
  expect(readFileSync(join(p.dir, 'Makefile'), 'utf8')).toContain('# local edit')
}, 120_000)

test('83.4 a builder that never converges stops at the default cap of 5 and keeps its branch', () => {
  project()
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [red(1), red(2), red(3), red(4), red(5)] } })
  const r = p.werk(['build', '7'])
  expect(r.code).not.toBe(0)
  const branch = branchOf(r.stdout)
  expect(git('rev-parse', '--verify', branch)).not.toBe('')
  const commits = git('log', '--format=%s', `main..${branch}`).split('\n')
  expect(commits.filter((s) => /pass \d+$/.test(s))).toHaveLength(5)
  const lines = runRecord()
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
}, 180_000)

test('83.5 the board shows the ticket in building with its retry count', async () => {
  project()
  expect(boardTicket()?.column).toBe('ready')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [red(1), red(2), green] } })
  const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts'), 'build', '7'], {
    cwd: p.dir,
    env: p.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let sawBuilding = false
  while (child.exitCode === null) {
    if (boardTicket()?.column === 'building') sawBuilding = true
    await Bun.sleep(50)
  }
  await child.exited
  expect(sawBuilding).toBe(true)
  expect(boardTicket()).toMatchObject({ column: 'building', retries: 2 })
}, 120_000)
