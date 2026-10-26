/** Feature 85: the overseer of a build pass. "A few milliseconds" is 20 ms here. */
import { afterEach, expect, test } from 'bun:test'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import type { Project } from '../../src/test/harness.ts'
import { branchOf, buildProject, finishing, git, judges, runRecord, TICKET } from './build-helpers.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})
const LINES = ['ac-1', 'ac-2', '#store']
const FEW_MS = '20'
const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, content = 'ok') => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: content !== 'ok' }] } },
})
const acts = () => runRecord(p).map((l) => l.overseer.map((a: { act: string; reason?: string }) => a.act + (a.reason ? `:${a.reason}` : '')))
const doneOnBranch = (stdout: string) => git(p, 'show', `${branchOf(stdout)}:done.txt`)

test('85.1 an unanswered permission ask gets an answer and the build continues', () => {
  p = buildProject()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [asking] } })
  const r = p.werk(['build', String(TICKET)])
  const record = runRecord(p)
  expect(record[0].overseer).toContainEqual(expect.objectContaining({ act: 'answered', requestId: 'ask-1', tool: 'Bash' }))
  expect(p.agentInputs()[0]).toContainEqual(expect.objectContaining({ type: 'control_response', response: expect.objectContaining({ request_id: 'ask-1' }) }))
  expect(record[0].agentExit).toBe(0)
  expect(doneOnBranch(r.stdout)).toBe('done')
  expect(r.code).toBe(0)
})

test('85.2 a silent agent is cancelled and a fresh pass starts', () => {
  p = buildProject()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [silent, finishing] } })
  const r = p.werk(['build', String(TICKET), '--silence-limit', FEW_MS])
  console.log('85.2 stdout:', r.stdout, 'acts:', JSON.stringify(acts()))
  const all = acts()
  expect(all[0]).toContain('cancelled:silence')
  expect(all.length).toBeGreaterThanOrEqual(2)
  expect(doneOnBranch(r.stdout)).toBe('done')
  expect(r.code).toBe(0)
})

test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  p = buildProject()
  const steps = []
  for (let i = 0; i < 40; i++) steps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, 'make: *** [check] Error 1'), { sleep: 50 })
  const looping: FakeReply = { steps }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [looping], 'loop-classifier': classifier } })
  const r = p.werk(['build', String(TICKET), '--cap', '1', '--loop-every', FEW_MS])
  console.log('85.3 stdout:', r.stdout, 'acts:', JSON.stringify(acts()))
  const first = acts()[0]
  expect(first.filter((a: string) => a === 'warned')).toHaveLength(1)
  const warned = first.indexOf('warned')
  const cancelled = first.indexOf('cancelled:loop')
  expect(cancelled).toBeGreaterThan(warned)
  expect(first.slice(0, warned).some((a: string) => a.startsWith('cancelled'))).toBe(false)
})

test('85.4 a long tool call in flight is not cancelled as silence', () => {
  p = buildProject()
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 25 * Number(FEW_MS) }, toolResult('t1'), ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [slowTool] } })
  const r = p.werk(['build', String(TICKET), '--silence-limit', FEW_MS])
  console.log('85.4 stdout:', r.stdout, 'acts:', JSON.stringify(acts()))
  expect(acts().flat()).not.toContain('cancelled:silence')
  expect(runRecord(p)).toHaveLength(1)
  expect(doneOnBranch(r.stdout)).toBe('done')
  expect(r.code).toBe(0)
})
