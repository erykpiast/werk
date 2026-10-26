/** Held-out steps 83.1-83.5: the build verb with a fake builder. */
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

/** `make check` passes when done.txt is there; else it prints `size` characters, then a mark, and fails. */
const makefile = (size: number) =>
  ['check:', `\t@test -f done.txt || { head -c ${size} /dev/zero | tr "\\\\0" y; echo; echo "TAIL-OF-OUTPUT done.txt is missing"; exit 1; }`, ''].join('\n')

const ticket: TicketFields = {
  number: 7,
  title: 'Make the done file',
  cites: ['loop'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.',
  root: 'root',
}

function project(size = 200): Project {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile(size))
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('root'), accepted('loop'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: ticket }]
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
const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)?.[0] ?? ''
const runRecord = () => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const prompts = () => p.agentLaunches().map((argv) => argv[argv.indexOf('-p') + 1]!)
const boardTicket = () => {
  const b = foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
  for (const c of b.columns) for (const t of c.tickets) if (t.number === 7) return { column: c.name, retries: t.retries }
  return undefined
}

test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  project()
  p.scriptAgent({ steps: [], roles: { builder: [red, green] } })
  const r = p.werk(['build', '7'])
  console.log('83.1', JSON.stringify(r))
  expect(r.code).toBe(0)
  expect(r.stdout).toMatch(/green/)
  const branch = branchOf(r.stdout)
  const subjects = git('log', '--format=%s', `main..${branch}`).split('\n').toReversed()
  expect(subjects).toHaveLength(2)
  expect(subjects[0]).toMatch(/pass 1$/)
  expect(subjects[1]).toMatch(/pass 2$/)
  const lines = runRecord()
  console.log('83.1 record', JSON.stringify(lines))
  expect(lines).toHaveLength(2)
  for (const l of lines) {
    expect(l.checks.length).toBeGreaterThan(0)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks[0]).toMatchObject({ cmd: 'make check', ok: false })
  expect(lines[1].checks[0]).toMatchObject({ cmd: 'make check', ok: true })
})

test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  project(20_000)
  p.scriptAgent({ steps: [], roles: { builder: [red, green] } })
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  const [first, second] = prompts()
  expect(prompts()).toHaveLength(2)
  expect(second).toContain('make check')
  expect(second).toContain('TAIL-OF-OUTPUT done.txt is missing')
  const yRun = /y{50,}/.exec(second!)?.[0] ?? ''
  // The failure text: everything from the last-failure heading on, if there is one; else the run of output.
  const at = second!.lastIndexOf('Last failure')
  const failure = at === -1 ? yRun : second!.slice(at)
  console.log('83.2 failure length', failure.length, 'y run', yRun.length, 'second prompt length', second!.length)
  expect(failure.length).toBeLessThanOrEqual(4200)
  expect(first).not.toContain('TAIL-OF-OUTPUT')
  expect(first).not.toMatch(/y{50,}/)
  console.log('83.2 first prompt tail', JSON.stringify(first!.slice(-120)))
})

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  project()
  writeFileSync(join(p.dir, 'notes.txt'), 'committed\n')
  p.run(['git', 'add', 'notes.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git('rev-parse', 'main')
  writeFileSync(join(p.dir, 'notes.txt'), 'LOCAL-UNCOMMITTED-CHANGE\n')
  writeFileSync(join(p.dir, 'scratch.txt'), 'LOCAL-UNTRACKED-FILE\n')
  p.scriptAgent({ steps: [], roles: { builder: [red, green] } })
  const r = p.werk(['build', '7'])
  console.log('83.3', JSON.stringify(r))
  const branch = branchOf(r.stdout)
  const first = git('rev-list', '--reverse', `main..${branch}`).split('\n')[0]!
  expect(git('rev-parse', `${first}^1`)).toBe(tip)
  const patch = git('log', '-p', '--format=%H', `main..${branch}`)
  expect(patch).not.toContain('LOCAL-UNCOMMITTED-CHANGE')
  expect(patch).not.toContain('LOCAL-UNTRACKED-FILE')
  expect(readFileSync(join(p.dir, 'notes.txt'), 'utf8')).toBe('LOCAL-UNCOMMITTED-CHANGE\n')
  expect(readFileSync(join(p.dir, 'scratch.txt'), 'utf8')).toBe('LOCAL-UNTRACKED-FILE\n')
  expect(git('status', '--porcelain')).toContain('notes.txt')
})

test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  project()
  p.scriptAgent({ steps: [], roles: { builder: [red] } })
  const r = p.werk(['build', '7'])
  console.log('83.4', JSON.stringify(r))
  expect(r.code).not.toBe(0)
  expect(r.stdout).toMatch(/5 passes/)
  const branch = branchOf(r.stdout)
  expect(git('branch', '--list', branch)).toContain(branch)
  expect(git('rev-list', '--count', `main..${branch}`)).toBe('5')
  const lines = runRecord()
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.green).toBe(false)
    expect(l.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
})

test('83.5 the board shows the ticket in building with its retry count', () => {
  project()
  expect(boardTicket()?.column).toBe('ready')
  p.scriptAgent({ steps: [], roles: { builder: [red, red, green] } })
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  console.log('83.5', JSON.stringify(boardTicket()))
  expect(boardTicket()).toEqual({ column: 'building', retries: 2 })
})
