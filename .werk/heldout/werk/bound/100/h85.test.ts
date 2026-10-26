/** Held-out steps 85.x: the overseer of a build pass. */
import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply } from '../src/test/fake-agent.ts'
import type { Project } from '../src/test/harness.ts'
import { branchOf, finishing, git, judges, project, prompts, runRecord } from './h8-build.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
})

/** A few milliseconds, for the silence limit and the loop check interval. */
const FEW_MS = '50'

/** The session event log of the ticket's last builder pass. */
const sessionLog = () =>
  readFileSync(join(p.dir, '.werk', 'sessions', '7.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { event?: Record<string, unknown>; overseer?: { act: string; reason?: string } })

const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, isError = false) => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: isError ? 'make: *** [check] Error 1' : 'ok', is_error: isError }] } },
})

// Scenario: An unanswered permission ask gets an answer and the build continues
test('85.1 an open permission ask gets an answer and the build goes on', () => {
  p = project()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [asking] } })
  const r = p.werk(['build', '7'])
  // the event log shows the permission ask and an answer to it from the overseer
  const log = sessionLog()
  expect(log.some((e) => e.event?.type === 'control_request')).toBe(true)
  expect(log.some((e) => e.overseer?.act === 'answered')).toBe(true)
  const builder = p.agentRoles().indexOf('builder')
  expect(p.agentInputs()[builder]).toContainEqual(
    expect.objectContaining({ type: 'control_response', response: expect.objectContaining({ request_id: 'ask-1' }) }),
  )
  // And the fake agent continues after the answer and finishes its pass
  expect(log.some((e) => e.event?.type === 'result')).toBe(true)
  expect(runRecord(p)[0].agentExit).toBe(0)
  // And the ticket branch has a commit with the agent's file edit
  const branch = branchOf(r.stdout)
  expect(git(p, 'log', '--name-only', '--format=', `main..${branch}`)).toContain('done.txt')
  // And the build exits with a success code
  expect(r.code).toBe(0)
})

// Scenario: A silent agent is cancelled and a fresh pass starts
test('85.2 a silent agent is cancelled and a fresh pass starts', () => {
  p = project()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [silent, finishing] } })
  const r = p.werk(['build', '7', '--silence-limit', FEW_MS])
  const lines = runRecord(p)
  // the event log shows that the overseer cancelled the first session for silence
  expect(lines[0].agentCancelled).toBe('silence')
  expect(lines[0].overseer.map((a: { act: string }) => a.act)).toContain('cancelled')
  // And the event log shows a second build pass for the same ticket
  expect(lines.length).toBeGreaterThanOrEqual(2)
  expect(lines[1]).toMatchObject({ ticket: 7, pass: 2 })
  // And the ticket branch has the commit from the second pass
  const branch = branchOf(r.stdout)
  expect(git(p, 'log', '--format=%s', `main..${branch}`)).toContain('pass 2')
  expect(git(p, 'ls-tree', '--name-only', branch)).toContain('done.txt')
  // And the build exits with a success code
  expect(r.code).toBe(0)
}, 30_000)

// Scenario: A looping agent gets one warning, then its session is cancelled
test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  p = project()
  const repeats = Array.from({ length: 6 }, (_, i) => [toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, true)]).flat()
  const looping: FakeReply = { steps: [...repeats, { sleep: 10_000 }] }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [looping], 'loop-classifier': classifier } })
  p.werk(['build', '7', '--cap', '1', '--loop-every', FEW_MS])
  const acts = runRecord(p)[0].overseer.map((a: { act: string; reason?: string }) => a.act)
  // one warning from the overseer to the agent about the loop
  expect(acts.filter((a: string) => a === 'warned')).toHaveLength(1)
  const builder = p.agentRoles().indexOf('builder')
  const warnings = p.agentInputs()[builder]!.filter((m) => JSON.stringify(m).includes('werk overseer'))
  expect(warnings).toHaveLength(1)
  // after the warning, the overseer cancelled the session for looping
  const cancelAt = acts.indexOf('cancelled')
  expect(cancelAt).toBeGreaterThan(acts.indexOf('warned'))
  expect(runRecord(p)[0].agentCancelled).toBe('loop')
  // But no cancellation before the warning
  expect(acts.slice(0, acts.indexOf('warned'))).not.toContain('cancelled')
  const log = sessionLog().filter((e) => e.overseer)
  expect(log.map((e) => e.overseer!.act)).toEqual(['warned', 'cancelled'])
}, 30_000)

// Scenario: A long tool call in flight is not cancelled as silence
test('85.4 a tool call in flight is not cancelled as silence', () => {
  p = project()
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 1500 }, toolResult('t1'), ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [slowTool] } })
  const r = p.werk(['build', '7', '--silence-limit', FEW_MS])
  const lines = runRecord(p)
  expect(lines.every((l) => l.agentCancelled !== 'silence')).toBe(true)
  expect(lines).toHaveLength(1)
  expect(prompts(p)).toHaveLength(1)
  const branch = branchOf(r.stdout)
  expect(git(p, 'log', '--name-only', '--format=', `main..${branch}`)).toContain('done.txt')
  expect(r.code).toBe(0)
}, 30_000)
