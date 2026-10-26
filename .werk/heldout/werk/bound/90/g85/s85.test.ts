/** Held-out steps 85.1–85.4: the overseer of a build pass. */
import { afterEach, expect, test } from 'bun:test'
import type { Project } from '../../src/test/harness.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { git, judges, project, result, runRecord, sessionEntries, ticketOf, toolResult, toolUse } from './common.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

const MAKEFILE = 'check:\n\t@test -f done.txt || { echo "done.txt is missing"; exit 1; }\n'
const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]
const fresh = () => (p = project(MAKEFILE, [ticketOf(3, { root: undefined })]))

test('85.1 an unanswered permission ask gets an answer and the build continues', () => {
  fresh()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [asking] } })
  const r = p.werk(['build', '3'])
  const entries = sessionEntries(p, 3)
  // The event log of the pass holds the ask, then the overseer's answer to it.
  const askAt = entries.findIndex((e) => e.event?.type === 'control_request' && e.event.request_id === 'ask-1')
  const answerAt = entries.findIndex((e) => e.overseer?.act === 'answered' && e.overseer.requestId === 'ask-1')
  expect(askAt).toBeGreaterThanOrEqual(0)
  expect(answerAt).toBeGreaterThan(askAt)
  // The agent went on after the answer and finished its pass.
  expect(entries.some((e, i) => i > answerAt && e.event?.type === 'result')).toBe(true)
  expect(runRecord(p)[0]).toMatchObject({ agentExit: 0, agentCancelled: null })
  expect(git(p, 'ls-tree', '--name-only', branchOf(r.stdout))).toContain('done.txt')
  expect(r.code).toBe(0)
}, 60_000)

test('85.2 a silent agent is cancelled and a fresh pass starts', () => {
  fresh()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [silent, finishing] } })
  const r = p.werk(['build', '3', '--silence-limit', '5'])
  const record = runRecord(p)
  // The first session was cancelled for silence.
  expect(record[0]).toMatchObject({ pass: 1, agentCancelled: 'silence' })
  expect(record[0].overseer).toContainEqual(expect.objectContaining({ act: 'cancelled', reason: 'silence' }))
  // A second build pass of the same ticket.
  expect(record[1]).toMatchObject({ ticket: 3, pass: 2 })
  expect(git(p, 'log', '--format=%s', `main..${branchOf(r.stdout)}`)).toContain('werk build 3: pass 2')
  expect(git(p, 'ls-tree', '--name-only', branchOf(r.stdout))).toContain('done.txt')
  expect(r.code).toBe(0)
}, 60_000)

test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  fresh()
  const repeat = Array.from({ length: 30 }, (_, i) => [toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, true), { sleep: 20 }]).flat()
  const looping: FakeReply = { steps: [...repeat, { sleep: 10_000 }] }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [looping], 'loop-classifier': classifier } })
  p.werk(['build', '3', '--cap', '1', '--loop-every', '5'])
  const acts = sessionEntries(p, 3).flatMap((e) => (e.overseer ? [e.overseer] : []))
  const warnings = acts.filter((a) => a.act === 'warned')
  expect(warnings).toHaveLength(1)
  const warnAt = acts.findIndex((a) => a.act === 'warned')
  const cancelAt = acts.findIndex((a) => a.act === 'cancelled')
  expect(cancelAt).toBeGreaterThan(warnAt)
  expect(acts[cancelAt]).toMatchObject({ reason: 'loop' })
  expect(acts.slice(0, warnAt).some((a) => a.act === 'cancelled')).toBe(false)
  // The warning reached the agent.
  const inputs = p.agentInputs()[p.agentRoles().indexOf('builder')]!
  expect(JSON.stringify(inputs)).toContain('werk overseer: you repeat the same steps')
}, 60_000)

test('85.4 a long tool call in flight is not cancelled as silence', () => {
  fresh()
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 1500 }, toolResult('t1'), ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [slowTool] } })
  const r = p.werk(['build', '3', '--silence-limit', '5'])
  const record = runRecord(p)
  expect(record.flatMap((l) => l.overseer).filter((a: { act: string; reason?: string }) => a.act === 'cancelled' && a.reason === 'silence')).toEqual([])
  expect(record).toHaveLength(1)
  expect(git(p, 'ls-tree', '--name-only', branchOf(r.stdout))).toContain('done.txt')
  expect(r.code).toBe(0)
}, 60_000)
