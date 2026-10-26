/** Held-out steps 83.1-83.5: the build verb with a fake builder. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import type { BoardEvent, NewBoardEvent, TicketFields } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

const ticket: TicketFields = {
  number: 3,
  title: 'The thing is done',
  cites: ['loop'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.',
  root: 'root',
}

function project(makefile: string): Project {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile)
  writeFileSync(join(p.dir, 'tracked.txt'), 'original\n')
  p.run(['git', 'add', 'Makefile', 'tracked.txt'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: ticket }]
  writeFileSync(
    join(werk, 'board.jsonl'),
    board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n',
  )
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. As a builder, I want done.txt.\n')
  return p
}

const SIMPLE = ['check:', '\t@test -f done.txt || { echo "done.txt is missing"; exit 1; }', ''].join('\n')
const LONG = ['check:', '\t@test -f done.txt || { head -c 20000 /dev/zero | tr "\\\\0" y; echo; echo "TAIL-MARK of the failure"; exit 1; }', ''].join('\n')

const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1 } })
const working: FakeReply = { steps: [{ edit: { path: 'work.txt', content: String(Math.random()) } }, result(0.1)] }
const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }
const judgeReply = (object: unknown): FakeReply => ({
  steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: JSON.stringify(object) } }],
})
const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)
const judges = () => ({
  grader: judgeReply({ lines: ['ac-1', '#loop', '#root'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(REVIEWERS.map((r) => [r, judgeReply({ findings: [] })])),
})

const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]
const runRecord = () => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const promptOf = (lines: unknown[]) =>
  (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } }).message.content
const builderPrompts = () => {
  const roles = p.agentRoles()
  return p.agentInputs().flatMap((lines, i) => (roles[i] === 'builder' ? [promptOf(lines)] : []))
}
const boardTicket = () =>
  foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, number: t.number, retries: t.retries })))
    .find((t) => t.number === 3)

test('83.1', () => {
  project(SIMPLE)
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('green')
  const branch = branchOf(r.stdout)
  expect(git('log', '--format=%s', `main..${branch}`).split('\n').toReversed()).toEqual(['werk build 3: pass 1', 'werk build 3: pass 2'])
  const lines = runRecord()
  expect(lines).toHaveLength(2)
  for (const l of lines) {
    expect(Array.isArray(l.checks) && l.checks.length > 0).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks[0]).toMatchObject({ cmd: 'make check', ok: false })
  expect(lines[1].checks[0]).toMatchObject({ cmd: 'make check', ok: true })
})

test('83.2', () => {
  project(LONG)
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working, finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  const [first, second] = builderPrompts()
  expect(builderPrompts()).toHaveLength(2)
  expect(second).toContain('make check')
  expect(second).toContain('TAIL-MARK of the failure')
  const failure = second!.slice(second!.indexOf('## Last failure'))
  expect(failure.length).toBeLessThanOrEqual(4200)
  expect(second!.length).toBeLessThan(first!.length + 4200)
  expect(first).not.toContain('TAIL-MARK')
  expect(first).not.toContain('yyyyyyyyyy')
  expect(first).not.toContain('Exit code')
})

test('83.3', () => {
  project(SIMPLE)
  p.run(['git', 'commit', '--quiet', '--allow-empty', '-m', 'New tip of main'])
  const tip = git('rev-parse', 'main')
  writeFileSync(join(p.dir, 'tracked.txt'), 'LOCAL-UNCOMMITTED-CHANGE\n')
  writeFileSync(join(p.dir, 'untracked-local.txt'), 'LOCAL-UNTRACKED\n')
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [finishing] } })
  const r = p.werk(['build', '3'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  const passes = git('rev-list', '--reverse', `main..${branch}`).split('\n')
  expect(git('rev-parse', `${passes[0]}^1`)).toBe(tip)
  const patch = p.run(['git', 'log', '-p', '--all-match', `main..${branch}`]).stdout
  expect(patch).not.toContain('LOCAL-UNCOMMITTED-CHANGE')
  expect(patch).not.toContain('untracked-local.txt')
  expect(git('show', `${branch}:tracked.txt`)).toBe('original')
  expect(readFileSync(join(p.dir, 'tracked.txt'), 'utf8')).toBe('LOCAL-UNCOMMITTED-CHANGE\n')
  const status = git('status', '--porcelain')
  expect(status).toContain('tracked.txt')
  expect(status).toContain('untracked-local.txt')
})

test('83.4', () => {
  project(SIMPLE)
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [working] } })
  const r = p.werk(['build', '3'])
  expect(r.code).not.toBe(0)
  expect(r.stdout).toContain('retry cap')
  const branch = branchOf(r.stdout)
  expect(git('rev-parse', '--verify', `refs/heads/${branch}`)).not.toBe('')
  expect(git('log', '--format=%s', `main..${branch}`).split('\n')).toHaveLength(5)
  const lines = runRecord()
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.checks.some((c: { ok: boolean }) => !c.ok)).toBe(true)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
})

test('83.5', async () => {
  project(SIMPLE)
  expect(boardTicket()?.column).toBe('ready')
  const slow: FakeReply = { steps: [{ sleep: 1500 }, ...working.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [slow, working, finishing] } })
  const MAIN = join(import.meta.dir, '..', 'src', 'cli', 'main.ts')
  const child = spawn(process.execPath, [MAIN, 'build', '3'], { cwd: p.dir, env: p.env, stdio: 'ignore' })
  const done = new Promise<number | null>((resolve) => child.on('exit', resolve))
  let sawBuilding = false
  let ended = false
  void done.then(() => (ended = true))
  // The person looks at the board while the build runs.
  while (!ended) {
    if (boardTicket()?.column === 'building') sawBuilding = true
    await Bun.sleep(100)
  }
  expect(await done).toBe(0)
  expect(sawBuilding).toBe(true)
  expect(boardTicket()?.retries).toBe(2)
}, 60000)
