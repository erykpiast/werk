/** Held-out steps 83.x and 85.x: the build verb with the fake builder. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
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

const SHORT_MAKEFILE = 'check:\n\t@test -f done.txt || { echo "done.txt is missing"; exit 1; }\n'
// About 20,000 characters of output, then a mark at the end.
const LONG_MAKEFILE =
  'check:\n\t@test -f done.txt || { head -c 20000 /dev/zero | tr "\\\\0" y; echo; echo "TAIL-MARK-OF-OUTPUT"; exit 1; }\n'

const ticket: TicketFields = {
  number: 7,
  title: 'Make done.txt',
  cites: ['loop'],
  blockedBy: [],
  stories: [1],
  touches: ['builder loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.',
  root: 'root',
}

function setup(makefile = SHORT_MAKEFILE): Project {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), makefile)
  p.run(['git', 'add', 'Makefile'])
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

const result = (cost: number) => ({ event: { type: 'result', subtype: 'success', total_cost_usd: cost, num_turns: 1 } })
const red: FakeReply = { steps: [{ edit: { path: 'work.txt', content: String(Math.random()) } }, result(0.1)] }
const green: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }

const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)?.[0] ?? ''
const runRecord = () => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const boardTicket = () =>
  foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
    .columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, retries: t.retries, number: t.number })))
    .find((t) => t.number === 7)
const builderPrompts = () =>
  p
    .agentInputs()
    .filter((lines) => lines.length > 0)
    .map((lines) => (lines.find((l) => (l as { type?: string }).type === 'user') as { message: { content: string } }).message.content)

test('83.1 a ticket that fails its checks once is green on the second pass', () => {
  setup()
  p.scriptAgent({ steps: [], roles: { builder: [red, green] } })
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('green')
  const branch = branchOf(r.stdout)
  expect(git('log', '--format=%s', `main..${branch}`).split('\n')).toEqual(['werk build 7: pass 2', 'werk build 7: pass 1'])
  const lines = runRecord()
  expect(lines).toHaveLength(2)
  for (const l of lines) {
    expect(Array.isArray(l.checks) && l.checks.length).toBeGreaterThan(0)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
  expect(lines[0].checks[0].ok).toBe(false)
  expect(lines[1].checks[0].ok).toBe(true)
}, 60_000)

test('83.2 the next pass receives the last failure, cut to about 4,000 characters', () => {
  setup(LONG_MAKEFILE)
  p.scriptAgent({ steps: [], roles: { builder: [red, green] } })
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  const [first, second] = builderPrompts()
  expect(second).toContain('make check')
  expect(second).toContain('TAIL-MARK-OF-OUTPUT')
  const failure = second!.slice(second!.indexOf('## Last failure'))
  expect(failure.length).toBeLessThanOrEqual(4200)
  expect(first).not.toContain('TAIL-MARK-OF-OUTPUT')
  expect(first).not.toContain('Exit code')
  expect(first).not.toContain('yyyyyyyyyy')
}, 60_000)

test('83.3 the build starts from the tip of the main line, not from the working tree', () => {
  setup()
  writeFileSync(join(p.dir, 'README.md'), 'one\n')
  p.run(['git', 'add', 'README.md'])
  p.run(['git', 'commit', '--quiet', '-m', 'A new commit at the tip'])
  const tip = git('rev-parse', 'main')
  writeFileSync(join(p.dir, 'README.md'), 'one\nlocal change\n')
  writeFileSync(join(p.dir, 'local.txt'), 'uncommitted\n')
  p.scriptAgent({ steps: [], roles: { builder: [green] } })
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  const branch = branchOf(r.stdout)
  const first = git('rev-list', '--reverse', `main..${branch}`).split('\n')[0]!
  expect(git('rev-parse', `${first}^1`)).toBe(tip)
  expect(git('show', `${branch}:README.md`)).toBe('one')
  expect(git('ls-tree', '-r', '--name-only', branch).split('\n')).not.toContain('local.txt')
  expect(git('log', '--all', '--format=%H', '--', 'local.txt')).toBe('')
  expect(readFileSync(join(p.dir, 'README.md'), 'utf8')).toBe('one\nlocal change\n')
  expect(existsSync(join(p.dir, 'local.txt'))).toBe(true)
  expect(git('status', '--porcelain')).toContain('README.md')
}, 60_000)

test('83.4 a builder that never converges stops at the retry cap and keeps its branch', () => {
  setup()
  p.scriptAgent({ steps: [], roles: { builder: [red] } })
  const r = p.werk(['build', '7'])
  expect(r.code).not.toBe(0)
  expect(r.stdout).toMatch(/5 passes/)
  const branch = branchOf(r.stdout)
  expect(git('rev-parse', '--verify', `refs/heads/${branch}`)).not.toBe('')
  expect(git('rev-list', '--count', `main..${branch}`)).toBe('5')
  const lines = runRecord()
  expect(lines).toHaveLength(5)
  for (const l of lines) {
    expect(l.checks[0].ok).toBe(false)
    expect(typeof l.ms).toBe('number')
    expect(typeof l.costUsd).toBe('number')
  }
}, 120_000)

test('83.5 the board shows the ticket in building with its retry count', () => {
  setup()
  expect(boardTicket()?.column).toBe('ready')
  p.scriptAgent({ steps: [], roles: { builder: [red, red, green] } })
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  expect(boardTicket()).toEqual({ column: 'building', retries: 2, number: 7 })
}, 60_000)

const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, content = 'ok') => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: content !== 'ok' }] } },
})

test('85.1 an unanswered permission ask gets an answer and the build continues', () => {
  setup()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch done.txt' } } }, ...green.steps] }
  p.scriptAgent({ steps: [], roles: { builder: [asking] } })
  const r = p.werk(['build', '7'])
  expect(r.code).toBe(0)
  const lines = runRecord()
  expect(lines[0].overseer).toContainEqual(expect.objectContaining({ act: 'answered', requestId: 'ask-1' }))
  expect(lines[0].agentExit).toBe(0)
  const branch = branchOf(r.stdout)
  expect(git('show', `${branch}:done.txt`)).toBe('done')
}, 60_000)

const SILENCE_MS = process.env.HELDOUT_SILENCE_MS ?? '20'

test('85.2 a silent agent is cancelled and a fresh pass starts', () => {
  setup()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { builder: [silent, green] } })
  const r = p.werk(['build', '7', '--silence-limit', SILENCE_MS])
  const lines = runRecord()
  expect(lines[0].agentCancelled).toBe('silence')
  expect(lines.length).toBeGreaterThanOrEqual(2)
  expect(lines[1].ticket).toBe(7)
  expect(lines[1].agentCancelled).toBeNull()
  expect(git('show', `${branchOf(r.stdout)}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)

test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  setup()
  const steps = []
  for (let i = 0; i < 6; i++) steps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, 'make: *** [check] Error 1'))
  const looping: FakeReply = { steps: [...steps, { sleep: 10_000 }] }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { builder: [looping], 'loop-classifier': classifier } })
  const r = p.werk(['build', '7', '--cap', '1', '--loop-every', '5'])
  const acts = runRecord()[0].overseer.map((a: { act: string; reason?: string }) => a.act + (a.reason ? `:${a.reason}` : ''))
  expect(acts.filter((a: string) => a === 'warned')).toHaveLength(1)
  const w = acts.indexOf('warned')
  const c = acts.indexOf('cancelled:loop')
  expect(c).toBeGreaterThan(w)
  expect(acts.slice(0, w).some((a: string) => a.startsWith('cancelled'))).toBe(false)
  expect(r.stdout).toContain('warned the agent')
}, 60_000)

test('85.4 a long tool call in flight is not cancelled as silence', () => {
  setup()
  const ms = Number(SILENCE_MS)
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: Math.max(ms * 20, 1000) }, toolResult('t1'), ...green.steps] }
  p.scriptAgent({ steps: [], roles: { builder: [slowTool] } })
  const r = p.werk(['build', '7', '--silence-limit', SILENCE_MS])
  const lines = runRecord()
  expect(lines.map((l) => l.agentCancelled)).toEqual([null])
  expect(lines).toHaveLength(1)
  expect(git('show', `${branchOf(r.stdout)}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)
