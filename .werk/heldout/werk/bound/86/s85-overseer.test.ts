import { afterEach, expect, test } from 'bun:test'
import type { TicketFields } from '../src/board/events.ts'
import type { FakeReply } from '../src/test/fake-agent.ts'
import type { Project } from '../src/test/harness.ts'
import { accepted, proposed } from '../src/test/map-events.ts'
import { branchOf, finishing, grading, makeBuildProject, quietReviewers, runRecord } from './build-kit.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})

/** "A few milliseconds" for the silence limit and the loop check interval. */
const FEW_MS = '10'

const ticket: TicketFields = {
  number: 3,
  title: 'Make done.txt',
  cites: ['loop'],
  blockedBy: [],
  stories: [1],
  touches: ['loop'],
  checks: ['make check'],
  brief: '## What to build\n\nMake done.txt.\n\n## Acceptance criteria\n\n- done.txt is there.',
  root: 'root',
}
const setup = () => {
  p = makeBuildProject(ticket, [proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop')])
}
const judges = () => ({ ...quietReviewers(), grader: grading(['ac-1', '#loop'], () => 4) })
const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, content = 'ok') => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } },
})

test('85.1 An unanswered permission ask gets an answer and the build continues', () => {
  setup()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [asking] } })
  const r = p.werk(['build', '3'])
  const [line] = runRecord(p)
  expect(line.overseer).toContainEqual(expect.objectContaining({ act: 'answered', requestId: 'ask-1', tool: 'Bash' }))
  const builder = p.agentRoles().indexOf('builder')
  expect(p.agentInputs()[builder]).toContainEqual(
    expect.objectContaining({ type: 'control_response', response: expect.objectContaining({ request_id: 'ask-1' }) }),
  )
  expect(line.agentExit).toBe(0)
  const branch = branchOf(r.stdout)!
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 30_000)

test('85.2 A silent agent is cancelled and a fresh pass starts', () => {
  setup()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [silent, finishing] } })
  const r = p.werk(['build', '3', '--silence-limit', FEW_MS])
  const lines = runRecord(p)
  expect(lines[0].agentCancelled).toBe('silence')
  expect(lines[0].overseer.map((a: { act: string }) => a.act)).toContain('cancelled')
  expect(lines.length).toBeGreaterThanOrEqual(2)
  expect(lines[1].ticket).toBe(3)
  expect(lines[1].pass).toBe(2)
  const branch = branchOf(r.stdout)!
  expect(git('log', '--format=%s', `main..${branch}`)).toContain('pass 2')
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)

test('85.3 A looping agent gets one warning, then its session is cancelled', () => {
  setup()
  const looping: FakeReply = {
    steps: [toolUse('t1', 'make check'), toolResult('t1', 'fail'), toolUse('t2', 'make check'), toolResult('t2', 'fail'), toolUse('t3', 'make check'), toolResult('t3', 'fail'), { sleep: 10_000 }],
  }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [looping], 'loop-classifier': classifier } })
  p.werk(['build', '3', '--loop-every', FEW_MS])
  const acts = runRecord(p)[0].overseer.map((a: { act: string; reason?: string }) => (a.act === 'cancelled' ? `cancelled:${a.reason}` : a.act))
  expect(acts.filter((a: string) => a === 'warned')).toHaveLength(1)
  const warnedAt = acts.indexOf('warned')
  const cancelledAt = acts.indexOf('cancelled:loop')
  expect(cancelledAt).toBeGreaterThan(warnedAt)
  expect(acts.slice(0, warnedAt).some((a: string) => a.startsWith('cancelled'))).toBe(false)
}, 90_000)

test('85.4 A long tool call in flight is not cancelled as silence', () => {
  setup()
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 1000 }, toolResult('t1'), ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [slowTool] } })
  const r = p.werk(['build', '3', '--silence-limit', FEW_MS])
  const lines = runRecord(p)
  expect(lines.map((l) => l.agentCancelled)).not.toContain('silence')
  expect(lines).toHaveLength(1)
  const branch = branchOf(r.stdout)!
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 60_000)
