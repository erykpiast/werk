/** Held-out steps 85.1 to 85.4: the overseer of a build pass. */
import { afterEach, expect, test } from 'bun:test'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import { judges, project, resultStep, ticketOf, type Ctx } from './common.ts'

const MAKEFILE = 'check:\n\t@test -f done.txt || { echo done.txt is missing; exit 1; }\n'
let c: Ctx
afterEach(() => c?.p.run(['git', 'worktree', 'prune']))

const finishing = [{ edit: { path: 'done.txt', content: 'done\n' } }, resultStep]
const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, content = 'ok', is_error = false) => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } },
})
const branchOf = (stdout: string) => /werk-build\/[\w-]+/.exec(stdout)![0]
const acts = (line: any) => (line.overseer as { act: string; reason?: string }[]).map((a) => (a.reason ? `${a.act}:${a.reason}` : a.act))

test('85.1 an unanswered permission ask gets an answer and the build continues', () => {
  c = project(MAKEFILE, [ticketOf(3)])
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...finishing] }
  c.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [asking] } })
  const r = c.p.werk(['build', '3'])

  // The event log of the session: the ask, then the overseer's answer to it.
  const entries = c.session(3)
  const askAt = entries.findIndex((e) => e.event?.type === 'control_request' && e.event.request_id === 'ask-1')
  const answerAt = entries.findIndex((e) => e.overseer?.act === 'answered' && e.overseer.requestId === 'ask-1')
  expect(askAt).toBeGreaterThanOrEqual(0)
  expect(answerAt).toBeGreaterThan(askAt)
  // The agent got the answer and went on to its final result.
  const builder = c.p.agentRoles().indexOf('builder')
  expect(c.p.agentInputs()[builder]).toContainEqual(
    expect.objectContaining({ type: 'control_response', response: expect.objectContaining({ request_id: 'ask-1' }) }),
  )
  const resultAt = entries.findIndex((e) => e.event?.type === 'result')
  expect(resultAt).toBeGreaterThan(answerAt)
  expect(c.runRecord()[0]).toMatchObject({ agentExit: 0, agentCancelled: null })
  expect(c.git('show', `${branchOf(r.stdout)}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 30_000)

test('85.2 a silent agent is cancelled and a fresh pass starts', () => {
  c = project(MAKEFILE, [ticketOf(3)])
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  c.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [silent, { steps: finishing }] } })
  // "A few milliseconds".
  const r = c.p.werk(['build', '3', '--silence-limit', '10'])
  const lines = c.runRecord()
  expect(lines[0]).toMatchObject({ pass: 1, agentCancelled: 'silence' })
  expect(acts(lines[0])).toEqual(['cancelled:silence'])
  expect(lines.filter((l) => l.ticket === 3).map((l) => l.pass)).toEqual([1, 2])
  expect(c.git('show', `${branchOf(r.stdout)}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 30_000)

test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  c = project(MAKEFILE, [ticketOf(3)])
  const steps = []
  for (let i = 0; i < 40; i++) steps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, 'done.txt is missing', true), { sleep: 50 })
  const looping: FakeReply = { steps: [...steps, { sleep: 20_000 }] }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  c.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [looping], 'loop-classifier': classifier } })
  c.p.werk(['build', '3', '--cap', '1', '--loop-every', '10'])

  const overseer = c.session(3).flatMap((e) => (e.overseer ? [e.overseer] : []))
  const warnings = overseer.filter((a) => a.act === 'warned')
  expect(warnings).toHaveLength(1)
  const warnAt = overseer.indexOf(warnings[0])
  const cancels = overseer.flatMap((a, i) => (a.act === 'cancelled' ? [{ a, i }] : []))
  expect(cancels).toHaveLength(1)
  expect(cancels[0]!.a.reason).toBe('loop')
  expect(cancels[0]!.i).toBeGreaterThan(warnAt)
  // The warning reached the agent.
  const builder = c.p.agentRoles().indexOf('builder')
  expect(JSON.stringify(c.p.agentInputs()[builder])).toContain('werk overseer: you repeat the same steps')
}, 30_000)

test('85.4 a long tool call in flight is not cancelled as silence', () => {
  c = project(MAKEFILE, [ticketOf(3)])
  // The limit is a few milliseconds; the tool call runs for many times that with no event.
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 1000 }, toolResult('t1'), ...finishing] }
  c.p.scriptAgent({ steps: [], roles: { ...judges(), builder: [slowTool] } })
  const r = c.p.werk(['build', '3', '--silence-limit', '10'])
  const lines = c.runRecord()
  expect(lines.flatMap((l) => acts(l)).filter((a) => a === 'cancelled:silence')).toEqual([])
  expect(lines).toHaveLength(1)
  expect(c.git('show', `${branchOf(r.stdout)}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 30_000)
