import { afterEach, expect, test } from 'bun:test'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import type { Project } from '../../src/test/harness.ts'
import { branchOf, finishing, gitOf, judges, project, runRecord, toolResult, toolUse } from './helpers.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})
const LINES = ['ac-1', '#loop']
const acts = (line: { overseer: { act: string }[] }) => line.overseer.map((a) => a.act)

test('85.1 An unanswered permission ask gets an answer and the build continues', () => {
  p = project()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [asking] } })
  const r = p.werk(['build', '3'])
  console.log(r.stdout, r.stderr)
  expect(runRecord(p)[0].overseer).toContainEqual(expect.objectContaining({ act: 'answered', requestId: 'ask-1' }))
  const builderInput = p.agentInputs()[p.agentRoles().indexOf('builder')]!
  expect(builderInput.some((m) => (m as any)?.type === 'control_response' && (m as any).response?.request_id === 'ask-1')).toBe(true)
  expect(runRecord(p)[0].agentExit).toBe(0)
  const branch = branchOf(r.stdout)!
  expect(gitOf(p)('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
})

test('85.2 A silent agent is cancelled and a fresh pass starts (silence limit 5 ms)', () => {
  p = project()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [silent, finishing] } })
  const r = p.werk(['build', '3', '--silence-limit', '5'])
  console.log(r.stdout, r.stderr)
  const rec = runRecord(p)
  console.log(JSON.stringify(rec.map((l) => [l.pass, l.agentCancelled, l.agentExit, acts(l)])))
  expect(rec[0].agentCancelled).toBe('silence')
  expect(rec.length).toBeGreaterThanOrEqual(2)
  expect(rec[1].ticket).toBe(3)
  const branch = branchOf(r.stdout)!
  expect(gitOf(p)('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)

test('85.3 A looping agent gets one warning, then its session is cancelled (loop interval 5 ms)', () => {
  p = project()
  const steps: FakeReply['steps'] = []
  for (let i = 1; i <= 6; i++) steps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, 'make: *** [check] Error 1'))
  steps.push({ sleep: 10_000 })
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [{ steps }], 'loop-classifier': classifier } })
  const r = p.werk(['build', '3', '--cap', '1', '--loop-every', '5'])
  console.log(r.stdout, r.stderr)
  const a = acts(runRecord(p)[0])
  expect(a.filter((x) => x === 'warned')).toHaveLength(1)
  const w = a.indexOf('warned')
  const c = a.indexOf('cancelled')
  expect(c).toBeGreaterThan(w)
  expect(runRecord(p)[0].agentCancelled).toBe('loop')
  expect(a.slice(0, w)).not.toContain('cancelled')
}, 30_000)

test('85.4 A long tool call in flight is not cancelled as silence (silence limit 5 ms)', () => {
  p = project()
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 500 }, toolResult('t1'), ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [slowTool] } })
  const r = p.werk(['build', '3', '--silence-limit', '5'])
  console.log(r.stdout, r.stderr)
  const rec = runRecord(p)
  console.log(JSON.stringify(rec.map((l) => [l.pass, l.agentCancelled, l.agentExit, acts(l)])))
  expect(rec.every((l) => l.agentCancelled !== 'silence')).toBe(true)
  expect(rec).toHaveLength(1)
  expect(gitOf(p)('show', `${branchOf(r.stdout)!}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)
