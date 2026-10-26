/** Held-out steps 85.1 - 85.4: the overseer of a build pass. */
import { afterEach, expect, test } from 'bun:test'
import type { TicketFields } from '../../src/board/events.ts'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import type { Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
import { allInputs, branchOf, git, judges, makeBuildProject, result, runRecord, sessionEntries } from './helpers.ts'

let p: Project | undefined
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
  p = undefined
})

const MAKEFILE = ['check:', '\t@test -f done.txt || { echo "done.txt is missing"; exit 1; }', ''].join('\n')
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
const log = logOf(proposed('root', { status: 'decided' }), proposed('loop', { status: 'decided', parent: 'root' }), accepted('loop'))
const LINES = ['ac-1', '#loop']
const setup = () => (p = makeBuildProject({ makefile: MAKEFILE, ticket, log }))

const finishing: FakeReply = { steps: [{ edit: { path: 'done.txt', content: 'done\n' } }, result(0.2)] }
const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, error = false) => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: error ? 'make: *** [check] Error 1' : 'ok', ...(error && { is_error: true }) }] } },
})

test('85.1 an unanswered permission ask gets an answer and the build continues', () => {
  const p = setup()
  // The ask, then the final result: the fake waits there for the answer. The edit comes after the answer.
  const asking: FakeReply = {
    steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, result(0.2), { edit: { path: 'done.txt', content: 'AGENT-EDIT-MARK\n' } }],
  }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [asking] } })
  const r = p.werk(['build', '3', '--cap', '1'])
  // The event log shows the permission ask and an answer to it from the overseer.
  const entries = sessionEntries(p, 3)
  const askAt = entries.findIndex((e) => e.event?.type === 'control_request' && e.event.request_id === 'ask-1')
  expect(askAt).toBeGreaterThanOrEqual(0)
  const answerAt = entries.findIndex((e) => e.overseer?.act === 'answered' && e.overseer.requestId === 'ask-1')
  expect(answerAt).toBeGreaterThan(askAt)
  expect(runRecord(p)[0].overseer).toContainEqual(expect.objectContaining({ act: 'answered', requestId: 'ask-1' }))
  // The fake agent continues after the answer and finishes its pass: the tool ran, not denied, then the result.
  const toolAt = entries.findIndex((e) =>
    (e.event?.message?.content ?? []).some?.((b: { type?: string; tool_use_id?: string }) => b.type === 'tool_result' && b.tool_use_id === 'ask-1'),
  )
  expect(toolAt).toBeGreaterThan(askAt)
  expect(JSON.stringify(entries[toolAt].event)).not.toContain('denied')
  expect(entries.findIndex((e) => e.event?.type === 'result')).toBeGreaterThan(toolAt)
  expect(runRecord(p)[0]).toMatchObject({ agentExit: 0, agentCancelled: null })
  // The ticket branch has a commit with the agent's file edit.
  const branch = branchOf(r.stdout)
  expect(p.run(['git', 'grep', '-q', 'AGENT-EDIT-MARK', branch]).code).toBe(0)
  // The build exits with a success code.
  expect(r.code).toBe(0)
}, 30_000)

test('85.2 a silent agent is cancelled and a fresh pass starts', () => {
  const p = setup()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [silent, { steps: [{ edit: { path: 'done.txt', content: 'PASS-TWO-MARK\n' } }, result(0.2)] }] } })
  // A few hundred milliseconds: the fake agent itself needs time to start under load.
  const r = p.werk(['build', '3', '--silence-limit', '1000'])
  const lines = runRecord(p)
  // The event log shows that the overseer cancelled the first session for silence.
  expect(lines[0].agentCancelled).toBe('silence')
  expect(lines[0].overseer).toContainEqual(expect.objectContaining({ act: 'cancelled', reason: 'silence' }))
  // The event log shows a second build pass for the same ticket.
  expect(lines).toHaveLength(2)
  expect(lines[1]).toMatchObject({ ticket: 3, pass: 2 })
  // The ticket branch has the commit from the second pass.
  const branch = branchOf(r.stdout)
  expect(git(p, 'log', '--format=%s', `main..${branch}`).split('\n')[0]).toMatch(/pass 2$/)
  expect(p.run(['git', 'grep', '-q', 'PASS-TWO-MARK', branch]).code).toBe(0)
  // The build exits with a success code.
  expect(r.code).toBe(0)
}, 30_000)

test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  const p = setup()
  const steps: FakeReply['steps'] = []
  for (let i = 1; i <= 6; i++) steps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, true))
  const looping: FakeReply = { steps: [...steps, { sleep: 10_000 }] }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [looping], 'loop-classifier': classifier } })
  p.werk(['build', '3', '--cap', '1', '--loop-every', '50'])
  const acts: { act: string; reason?: string }[] = runRecord(p)[0].overseer
  // One warning from the overseer to the agent about the loop.
  expect(acts.filter((a) => a.act === 'warned')).toHaveLength(1)
  expect(allInputs(p, 'builder').filter((l) => l.includes('werk overseer: you repeat the same steps'))).toHaveLength(1)
  // After the warning, the overseer cancelled the session for looping.
  const warnedAt = acts.findIndex((a) => a.act === 'warned')
  const cancelledAt = acts.findIndex((a) => a.act === 'cancelled' && a.reason === 'loop')
  expect(cancelledAt).toBeGreaterThan(warnedAt)
  // No cancellation before the warning.
  expect(acts.slice(0, warnedAt).filter((a) => a.act === 'cancelled')).toEqual([])
  // The session log shows the same order.
  const entries = sessionEntries(p, 3).filter((e) => e.overseer)
  expect(entries.map((e) => e.overseer.act)).toEqual(['warned', 'cancelled'])
}, 30_000)

test('85.4 a long tool call in flight is not cancelled as silence', () => {
  const p = setup()
  const slowTool: FakeReply = {
    steps: [toolUse('t1', 'make slow'), { sleep: 4000 }, toolResult('t1'), { edit: { path: 'done.txt', content: 'SLOW-EDIT-MARK\n' } }, result(0.2)],
  }
  p.scriptAgent({ steps: [], roles: { ...judges(LINES), builder: [slowTool] } })
  const r = p.werk(['build', '3', '--silence-limit', '1000'])
  const lines = runRecord(p)
  // No silence cancellation for that session.
  expect(lines[0].agentCancelled).toBeNull()
  expect(lines[0].overseer.filter((a: { act: string }) => a.act === 'cancelled')).toEqual([])
  // Only one build pass for the ticket.
  expect(lines).toHaveLength(1)
  expect(p.agentRoles().filter((x) => x === 'builder')).toHaveLength(1)
  // The ticket branch has a commit with the agent's file edit.
  expect(p.run(['git', 'grep', '-q', 'SLOW-EDIT-MARK', branchOf(r.stdout)]).code).toBe(0)
  // The build exits with a success code.
  expect(r.code).toBe(0)
}, 30_000)
