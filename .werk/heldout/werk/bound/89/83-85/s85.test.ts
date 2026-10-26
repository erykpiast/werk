import { afterEach, expect, test } from 'bun:test'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import type { Project } from '../../src/test/harness.ts'
import {
  branchOf,
  buildRoles,
  finishing,
  gitOf,
  judges,
  project,
  prompts,
  result,
  runRecord,
  sessionLog,
  toolResult,
  toolUse,
} from './util.ts'

let p: Project | undefined
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
  p = undefined
})

// Reading of "the event log": the overseer writes its acts in two places, the session log
// `.werk/sessions/<ticket>.jsonl` (the events of the agent and the acts of the overseer, of
// the last pass) and the `overseer` field of each pass line in the run record `.werk/runs/*.jsonl`.
// The session log is emptied at each new pass, so the per-pass view comes from the run record.

// Reading of "a few milliseconds": the limit is set from outside with `--silence-limit` and
// `--loop-every`. The fake agent is a Bun process that needs a few hundred ms to start under
// load, so a literal 5 ms silence limit would cancel every pass before its first event. The
// tests use a limit that is short compared to the silence in the script (1,500 ms silence,
// 20 ms loop check), the same scale as the product's own tests.

// 85.1
// Scenario: An unanswered permission ask gets an answer and the build continues
// Given a temporary git repository with one ticket ready to build
// And a fake build agent that emits a permission ask, waits for an answer, then edits a file and finishes
// When the person starts the build
// Then the event log shows the permission ask and an answer to it from the overseer
// And the fake agent continues after the answer and finishes its pass
// And the ticket branch has a commit with the agent's file edit
// And the build exits with a success code
test('85.1', () => {
  p = project()
  const git = gitOf(p)
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [asking] } })
  const r = p.werk(['build', '3'])
  console.log('85.1 stdout:\n' + r.stdout + '\nstderr:\n' + r.stderr)
  const session = sessionLog(p)
  console.log('85.1 session log:\n' + session.map((e) => JSON.stringify(e)).join('\n'))
  const askAt = session.findIndex((e) => e.event?.type === 'control_request' && e.event?.request_id === 'ask-1')
  const answerAt = session.findIndex((e) => e.overseer?.act === 'answered' && e.overseer?.requestId === 'ask-1')
  expect(askAt).toBeGreaterThanOrEqual(0)
  expect(answerAt).toBeGreaterThan(askAt)
  expect(runRecord(p)[0].overseer).toEqual([expect.objectContaining({ act: 'answered', requestId: 'ask-1' })])
  // The agent finished: its result event comes after the answer, and it exited 0.
  expect(session.findIndex((e) => e.event?.type === 'result')).toBeGreaterThan(answerAt)
  expect(runRecord(p)[0].agentExit).toBe(0)
  const branch = branchOf(r.stdout)
  expect(git('log', '--format=%H', '-1', branch, '--', 'done.txt')).not.toBe('')
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 120_000)

// 85.2
// Scenario: A silent agent is cancelled and a fresh pass starts
// Given a temporary git repository with one ticket ready to build
// And the silence limit is set to a few milliseconds
// And a fake build agent that goes silent with no tool call in flight on its first pass, and finishes normally on its second pass
// When the person starts the build
// Then the event log shows that the overseer cancelled the first session for silence
// And the event log shows a second build pass for the same ticket
// And the ticket branch has the commit from the second pass
// And the build exits with a success code
test('85.2', () => {
  p = project()
  const git = gitOf(p)
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 15_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [silent, finishing] } })
  const r = p.werk(['build', '3', '--silence-limit', '1500'])
  console.log('85.2 stdout:\n' + r.stdout)
  const lines = runRecord(p)
  console.log('85.2 run record overseer: ' + JSON.stringify(lines.map((l) => [l.pass, l.ticket, l.agentCancelled, l.overseer])))
  expect(lines[0].overseer).toEqual([expect.objectContaining({ act: 'cancelled', reason: 'silence' })])
  expect(lines[0].agentCancelled).toBe('silence')
  expect(lines).toHaveLength(2)
  expect(lines[1]).toMatchObject({ pass: 2, ticket: 3, agentCancelled: null })
  const branch = branchOf(r.stdout)
  const subjects = git('log', '--format=%s', `main..${branch}`)
  expect(subjects).toContain('pass 2')
  expect(git('rev-parse', branch)).toBe(lines[1].commit)
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 120_000)

// 85.3
// Scenario: A looping agent gets one warning, then its session is cancelled
// Given a temporary git repository with one ticket ready to build
// And the loop check interval is set to a few milliseconds
// And a fake build agent that repeats the same failing tool call again and again
// And a fake loop classifier that always answers "looping"
// When the person starts the build
// Then the event log shows one warning from the overseer to the agent about the loop
// And after the warning, the event log shows that the overseer cancelled the session for looping
// But the event log shows no cancellation before the warning
test('85.3', () => {
  p = project()
  const steps: FakeReply['steps'] = []
  for (let i = 1; i <= 6; i++) steps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, true))
  steps.push({ sleep: 15_000 })
  const looping: FakeReply = { steps }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [looping], 'loop-classifier': classifier } })
  const r = p.werk(['build', '3', '--loop-every', '20'])
  console.log('85.3 stdout:\n' + r.stdout)
  const lines = runRecord(p)
  console.log('85.3 run record overseer: ' + JSON.stringify(lines.map((l) => [l.pass, l.agentCancelled, l.overseer])))
  expect(lines.length).toBeGreaterThan(0)
  // Each pass is one session: one warning, then a cancel for the loop, and no cancel before the warning.
  for (const l of lines) {
    const acts = l.overseer.map((a: { act: string; reason?: string }) => (a.act === 'cancelled' ? `cancelled:${a.reason}` : a.act))
    expect(acts).toEqual(['warned', 'cancelled:loop'])
  }
  // The session log of the last pass shows the same order.
  const session = sessionLog(p).filter((e) => e.overseer).map((e) => e.overseer.act)
  console.log('85.3 last session overseer acts: ' + JSON.stringify(session))
  expect(session).toEqual(['warned', 'cancelled'])
  // The warning reached the agent on its stdin.
  const builder = p.agentRoles().indexOf('builder')
  const inputs = p.agentInputs()[builder]!.map((m) => JSON.stringify(m))
  expect(inputs.filter((m) => m.includes('werk overseer'))).toHaveLength(1)
}, 120_000)

// 85.4
// Scenario: A long tool call in flight is not cancelled as silence
// Given a temporary git repository with one ticket ready to build
// And the silence limit is set to a few milliseconds
// And a fake build agent that starts a tool call, emits no events for many times the silence limit, then gets the tool result, edits a file, and finishes
// When the person starts the build
// Then the event log shows no silence cancellation for that session
// And the event log shows only one build pass for the ticket
// And the ticket branch has a commit with the agent's file edit
// And the build exits with a success code
test('85.4', () => {
  p = project()
  const git = gitOf(p)
  const slowTool: FakeReply = { steps: [toolUse('t1', 'make slow'), { sleep: 7500 }, toolResult('t1'), ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [slowTool] } })
  const r = p.werk(['build', '3', '--silence-limit', '1500'])
  console.log('85.4 stdout:\n' + r.stdout)
  const lines = runRecord(p)
  console.log('85.4 run record: ' + JSON.stringify(lines.map((l) => [l.pass, l.agentCancelled, l.overseer])))
  const session = sessionLog(p)
  expect(session.filter((e) => e.overseer?.act === 'cancelled')).toEqual([])
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatchObject({ agentCancelled: null, overseer: [] })
  expect(buildRoles(p).filter((x) => x === 'builder')).toHaveLength(1)
  const branch = branchOf(r.stdout)
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 120_000)

void prompts
void result
