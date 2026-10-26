/** The "event log" of a pass is its run record line: `overseer` holds the overseer's acts in order. */
import { afterEach, expect, test } from 'bun:test'
import type { FakeReply } from '../src/test/fake-agent.ts'
import type { Project } from '../src/test/harness.ts'
import { branchOf, finishing, git, judges, runRecord, setupProject } from './s83-helpers.ts'

let p: Project | undefined
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
  p = undefined
})
const LINES = ['ac-1', '#loop']
const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, error = false) => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: error ? 'make: *** failed' : 'ok', is_error: error }] } },
})

test('85.1 an unanswered permission ask gets an answer and the build continues', () => {
  p = setupProject()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [asking] } })
  const r = p.werk(['build', '3'])
  const rec = runRecord(p)
  expect(rec[0].overseer).toEqual([expect.objectContaining({ act: 'answered', tool: 'Bash', requestId: 'ask-1' })])
  const builder = p.agentRoles().indexOf('builder')
  expect(p.agentInputs()[builder]).toContainEqual(
    expect.objectContaining({ type: 'control_response', response: expect.objectContaining({ request_id: 'ask-1' }) }),
  )
  expect(rec[0].agentExit).toBe(0)
  expect(git(p, 'show', `${branchOf(r.stdout)}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)

test('85.2 a silent agent is cancelled and a fresh pass starts', () => {
  p = setupProject()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [silent, finishing] } })
  // "A few milliseconds": 3000 ms. At 1000 ms a reviewer (also under the silence limit) was cancelled before its start under load; the silent pass sleeps 10 s.
  const r = p.werk(['build', '3', '--silence-limit', '3000'])
  const rec = runRecord(p)
  expect(rec[0].overseer).toEqual([expect.objectContaining({ act: 'cancelled', reason: 'silence' })])
  expect(rec[0].agentCancelled).toBe('silence')
  expect(rec).toHaveLength(2)
  expect(rec[1]).toMatchObject({ ticket: 3, pass: 2 })
  const branch = branchOf(r.stdout)
  expect(git(p, 'log', '-1', '--format=%s', branch)).toBe('werk build 3: pass 2')
  expect(git(p, 'show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)

test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  p = setupProject()
  const steps = []
  for (let i = 0; i < 6; i++) steps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, true))
  const looping: FakeReply = { steps: [...steps, { sleep: 10_000 }] }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [looping], 'loop-classifier': classifier } })
  const r = p.werk(['build', '3', '--cap', '1', '--loop-every', '150'])
  const acts = runRecord(p)[0].overseer as { act: string; reason?: string; ms: number }[]
  expect(acts.filter((a) => a.act === 'warned')).toHaveLength(1)
  const warnAt = acts.findIndex((a) => a.act === 'warned')
  const cancelAt = acts.findIndex((a) => a.act === 'cancelled')
  expect(cancelAt).toBeGreaterThan(warnAt)
  expect(acts[cancelAt]!.reason).toBe('loop')
  expect(acts.slice(0, warnAt).some((a) => a.act === 'cancelled')).toBe(false)
  const builder = p.agentRoles().indexOf('builder')
  const warnings = p.agentInputs()[builder]!.filter((m) => JSON.stringify(m).includes('werk overseer: you repeat the same steps'))
  expect(warnings).toHaveLength(1)
  expect(r.stdout).toContain('the overseer warned the agent that it loops')
}, 60_000)

test('85.4 a long tool call in flight is not cancelled as silence', () => {
  p = setupProject()
  // Silence limit 2000 ms (at 1000 ms a parallel reviewer was cancelled before its start under load); the tool runs 5 limits long.
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 10000 }, toolResult('t1'), ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [slowTool] } })
  const r = p.werk(['build', '3', '--silence-limit', '2000'])
  const rec = runRecord(p)
  expect(rec.flatMap((l) => l.overseer).filter((a: { act: string }) => a.act === 'cancelled')).toEqual([])
  expect(rec).toHaveLength(1)
  expect(git(p, 'show', `${branchOf(r.stdout)}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)
