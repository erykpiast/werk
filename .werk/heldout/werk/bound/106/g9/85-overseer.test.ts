/** Held-out steps 85.1 to 85.4: the overseer of a build pass. */
import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { branchOf, buildProject, buildRoles, finishing, git, judges, runRecord } from './lib.ts'

const LINES = ['ac-1', '#loop']
const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, content = 'ok', isError = false) => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } },
})
const sessionEntries = (dir: string) =>
  readFileSync(join(dir, '.werk', 'sessions', '3.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const builderPasses = (dir: string) =>
  readFileSync(join(dir, '.werk', 'board.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('85.1 an unanswered permission ask gets an answer and the build continues', () => {
  const p = buildProject()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch done.txt' } } }, ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [asking] } })
  const r = p.werk(['build', '3'])
  const entries = sessionEntries(p.dir)
  expect(entries.some((e) => e.event?.type === 'control_request' && e.event.request_id === 'ask-1')).toBe(true)
  expect(entries.some((e) => e.overseer?.act === 'answered' && e.overseer.requestId === 'ask-1')).toBe(true)
  // The agent went on after the answer: the tool result of the allowed ask, then the final result.
  const resultAt = entries.findIndex((e) => e.event?.type === 'result')
  const answeredAt = entries.findIndex((e) => e.overseer?.act === 'answered')
  expect(resultAt).toBeGreaterThan(answeredAt)
  expect(runRecord(p)[0]).toMatchObject({ agentExit: 0 })
  const branch = branchOf(r.stdout)
  expect(git(p, 'show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 30_000)

test('85.2 a silent agent is cancelled and a fresh pass starts', () => {
  const p = buildProject()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [silent, finishing] } })
  const r = p.werk(['build', '3', '--silence-limit', '10'])
  const lines = runRecord(p)
  expect(lines[0]).toMatchObject({ pass: 1, agentCancelled: 'silence' })
  expect(lines[1]).toMatchObject({ pass: 2 })
  expect(lines[1].agentCancelled).toBeNull()
  const branch = branchOf(r.stdout)
  expect(git(p, 'log', '--format=%s', '-1', branch)).toMatch(/pass 2$/)
  expect(git(p, 'show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)

test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  const p = buildProject()
  const steps = []
  for (let i = 1; i <= 6; i++) steps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, 'make: *** [check] Error 1', true))
  const looping: FakeReply = { steps: [...steps, { sleep: 10_000 }] }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [looping], 'loop-classifier': classifier } })
  p.werk(['build', '3', '--loop-every', '10'])
  const acts = runRecord(p)[0].overseer.map((a: { act: string; reason?: string }) => a.act + (a.reason ? `:${a.reason}` : ''))
  expect(acts.filter((a: string) => a === 'warned')).toHaveLength(1)
  const warnedAt = acts.indexOf('warned')
  const cancelledAt = acts.indexOf('cancelled:loop')
  expect(cancelledAt).toBeGreaterThan(warnedAt)
  expect(acts.slice(0, warnedAt).some((a: string) => a.startsWith('cancelled'))).toBe(false)
}, 90_000)

test('85.4 a long tool call in flight is not cancelled as silence', () => {
  const p = buildProject()
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 300 }, toolResult('t1'), ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [slowTool] } })
  const r = p.werk(['build', '3', '--silence-limit', '10'])
  const lines = runRecord(p)
  expect(lines.map((l) => l.agentCancelled)).not.toContain('silence')
  expect(buildRoles(p).filter((x) => x === 'builder')).toHaveLength(1)
  expect(builderPasses(p.dir).filter((e) => e.type === 'ticket.retried')).toHaveLength(0)
  expect(git(p, 'show', `${branchOf(r.stdout)}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)
