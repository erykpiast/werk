/** Held-out steps 85.1–85.4: the overseer of a build pass. The run record is the build's event log. */
import { expect, test } from 'bun:test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NewBoardEvent, TicketFields } from '../../src/board/events.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

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

function project(): Project {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), 'check:\n\t@test -f done.txt || { echo missing; exit 1; }\n')
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  const werk = join(p.dir, '.werk')
  mkdirSync(join(werk, 'plans', 'root'), { recursive: true })
  const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
  writeFileSync(join(werk, 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const board: NewBoardEvent[] = [{ type: 'ticket.planned', payload: ticket }]
  writeFileSync(join(werk, 'board.jsonl'), board.map((e, i) => JSON.stringify({ ...e, seq: i + 1, at: '2026-10-21T00:00:00.000Z', actor: 'agent' })).join('\n') + '\n')
  writeFileSync(join(werk, 'plans', 'root', 'spec.md'), '# Spec\n\n## User stories\n\n1. One.\n')
  return p
}

const result = { event: { type: 'result', subtype: 'success', total_cost_usd: 0.1, num_turns: 1 } }
const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result] }
const judge = (o: unknown): FakeReply => ({ steps: [{ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, result: JSON.stringify(o) } }] })
const judges = () => ({
  grader: judge({ lines: ['ac-1', '#loop'].map((id) => ({ id, score: 4, gap: 'none' })) }),
  ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, judge({ findings: [] })])),
})
const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, content = 'ok', is_error = false) => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } },
})
const runRecord = (p: Project) => {
  const runs = join(p.dir, '.werk', 'runs')
  const file = readdirSync(runs).find((f) => f.endsWith('.jsonl'))!
  return readFileSync(join(runs, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
}
const git = (p: Project, ...args: string[]) => p.run(['git', ...args]).stdout.trim()
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]

test('fast 85.1 an unanswered permission ask gets an answer and the build continues', () => {
  const p = project()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, { edit: { path: 'done.txt', content: 'AGENT-EDIT\n' } }, result] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [asking] } })
  const r = p.werk(['build', '3'])
  const [line] = runRecord(p)
  expect(line.overseer).toMatchObject([{ act: 'answered', requestId: 'ask-1' }])
  const builderInput = p.agentInputs()[p.agentRoles().indexOf('builder')]!
  expect(builderInput).toContainEqual(expect.objectContaining({ type: 'control_response' }))
  expect(line.agentExit).toBe(0)
  const branch = branchOf(r.stdout)
  expect(git(p, 'show', `${branch}:done.txt`)).toBe('AGENT-EDIT')
  expect(r.code).toBe(0)
}, 30_000)

test('fast 85.2 a silent agent is cancelled and a fresh pass starts', () => {
  const p = project()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [silent, finishing] } })
  // A few milliseconds is not enough for the fake agent to start, so the limit leaves room for its start.
  const r = p.werk(['build', '3', '--silence-limit', '20'])
  const lines = runRecord(p)
  expect(lines[0]).toMatchObject({ pass: 1, agentCancelled: 'silence' })
  expect(lines[0].overseer.map((a: { act: string }) => a.act)).toContain('cancelled')
  expect(lines[1]).toMatchObject({ pass: 2, ticket: 3 })
  const branch = branchOf(r.stdout)
  expect(git(p, 'log', '--format=%s', '-1', branch)).toContain('pass 2')
  expect(git(p, 'show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 30_000)

test('fast 85.3 a looping agent gets one warning, then its session is cancelled', () => {
  const p = project()
  const looping: FakeReply = {
    steps: [
      ...Array.from({ length: 6 }, (_, i) => [toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, 'make: *** [check] Error 1', true)]).flat(),
      { sleep: 10_000 },
    ],
  }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [looping], 'loop-classifier': classifier } })
  const r = p.werk(['build', '3', '--cap', '1', '--loop-every', '20'])
  const acts = runRecord(p)[0].overseer.map((a: { act: string; reason?: string }) => [a.act, a.reason])
  expect(acts.filter(([a]: string[]) => a === 'warned')).toHaveLength(1)
  const warnAt = acts.findIndex(([a]: string[]) => a === 'warned')
  const cancelAt = acts.findIndex(([a]: string[]) => a === 'cancelled')
  expect(warnAt).toBeGreaterThanOrEqual(0)
  expect(cancelAt).toBeGreaterThan(warnAt)
  expect(acts[cancelAt]).toEqual(['cancelled', 'loop'])
  expect(acts.slice(0, warnAt).some(([a]: string[]) => a === 'cancelled')).toBe(false)
  // The warning reached the agent on its input.
  const builderInput = p.agentInputs()[p.agentRoles().indexOf('builder')]!.map((m) => JSON.stringify(m))
  expect(builderInput.some((m) => m.includes('werk overseer'))).toBe(true)
  expect(r.stdout).toContain('warned')
}, 30_000)

test('fast 85.4 a long tool call in flight is not cancelled as silence', () => {
  const p = project()
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 1000 }, toolResult('t1'), { edit: { path: 'done.txt', content: 'AFTER-TOOL\n' } }, result] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [slowTool] } })
  const r = p.werk(['build', '3', '--silence-limit', '20'])
  const lines = runRecord(p)
  expect(lines.every((l) => l.agentCancelled !== 'silence')).toBe(true)
  expect(lines).toHaveLength(1)
  expect(git(p, 'show', `${branchOf(r.stdout)}:done.txt`)).toBe('AFTER-TOOL')
  expect(r.code).toBe(0)
}, 30_000)
