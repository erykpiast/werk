import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply } from '../../src/test/fake-agent.ts'
import type { Project } from '../../src/test/harness.ts'
import { branchOf, finishing, grading, isHeldout, project, REVIEWERS, reviewing, runRecord } from './setup.ts'

let p: Project
afterEach(() => {
  p?.run(['git', 'worktree', 'prune'])
  p?.cleanup()
})
const LINES = ['ac-1', 'ac-2', '#loop']
const judges = () => ({ grader: grading(LINES, () => 4), ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])) })
const toolUse = (id: string, command: string) => ({
  event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } },
})
const toolResult = (id: string, content = 'ok') => ({
  event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } },
})
const git = (...args: string[]) => p.run(['git', ...args]).stdout.trim()
const sessionEntries = () =>
  readFileSync(join(p.dir, '.werk', 'sessions', '3.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const builderPasses = () => p.agentRoles().filter((r) => r === 'builder').length

test('85.1 an unanswered permission ask gets an answer and the build continues', () => {
  p = project()
  const asking: FakeReply = { steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch x' } } }, ...finishing.steps] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [asking] } })
  const r = p.werk(['build', '3'])
  const lines = runRecord(p)
  expect(lines[0].overseer).toContainEqual(expect.objectContaining({ act: 'answered', requestId: 'ask-1' }))
  const entries = sessionEntries()
  expect(entries.some((e) => e.event?.type === 'control_request')).toBe(true)
  expect(entries.some((e) => e.overseer?.act === 'answered')).toBe(true)
  expect(lines[0].agentExit).toBe(0)
  const branch = branchOf(r.stdout)
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 30_000)

test('85.2 a silent agent is cancelled and a fresh pass starts', () => {
  p = project()
  const silent: FakeReply = { steps: [{ event: { type: 'system', subtype: 'init' } }, { sleep: 10_000 }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [silent, finishing] } })
  // "A few milliseconds" — a limit short against the agent's 10 s silence, with room for the fake agent to start.
  const r = p.werk(['build', '3', '--silence-limit', '200'])
  const lines = runRecord(p)
  console.log('85.2', r.stdout, JSON.stringify(lines.map((l) => [l.agentCancelled, l.overseer, l.green])))
  expect(lines[0].agentCancelled).toBe('silence')
  expect(lines[0].overseer).toContainEqual(expect.objectContaining({ act: 'cancelled', reason: 'silence' }))
  expect(lines.map((l) => l.pass)).toEqual([1, 2])
  expect(lines.every((l) => l.ticket === 3)).toBe(true)
  const branch = branchOf(r.stdout)
  expect(git('log', '-1', '--format=%s', branch)).toBe('werk build 3: pass 2')
  expect(git('show', `${branch}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
}, 30_000)

test('85.3 a looping agent gets one warning, then its session is cancelled', () => {
  p = project()
  const steps = []
  for (let i = 0; i < 6; i++) steps.push(toolUse(`t${i}`, 'make check'), toolResult(`t${i}`, 'make: *** [check] Error 1'))
  const looping: FakeReply = { steps: [...steps, { sleep: 10_000 }] }
  const classifier: FakeReply = { steps: [{ event: { type: 'result', subtype: 'success', result: 'looping' } }] }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [looping], 'loop-classifier': classifier } })
  p.werk(['build', '3', '--cap', '1', '--loop-every', '150'])
  const acts = runRecord(p)[0].overseer.map((a: { act: string }) => a.act)
  expect(acts.filter((a: string) => a === 'warned')).toHaveLength(1)
  const warnAt = acts.indexOf('warned')
  const cancelAt = acts.indexOf('cancelled')
  expect(cancelAt).toBeGreaterThan(warnAt)
  expect(runRecord(p)[0].agentCancelled).toBe('loop')
  expect(acts.slice(0, warnAt)).not.toContain('cancelled')
  const builder = p.agentRoles().indexOf('builder')
  const warnings = p.agentInputs()[builder]!.filter((m) => JSON.stringify(m).includes('werk overseer'))
  expect(warnings).toHaveLength(1)
}, 30_000)

test('85.4 a long tool call in flight is not cancelled as silence', () => {
  p = project()
  const slowTool: FakeReply = {
    steps: [toolUse('t1', 'make slow'), { sleep: 2000 }, toolResult('t1'), ...finishing.steps],
  }
  p.scriptAgent({ steps: [], roles: { ...judges(), builder: [slowTool] } })
  const r = p.werk(['build', '3', '--silence-limit', '200'])
  const lines = runRecord(p)
  console.log('85.4', r.stdout, JSON.stringify(lines.map((l) => [l.agentCancelled, l.overseer, l.green])))
  expect(lines.some((l) => l.agentCancelled === 'silence')).toBe(false)
  expect(lines).toHaveLength(1)
  expect(p.agentRoles().filter((x) => !isHeldout(x) && x === 'builder')).toHaveLength(1)
  expect(git('show', `${branchOf(r.stdout)}:done.txt`)).toBe('done')
  expect(r.code).toBe(0)
  expect(builderPasses()).toBe(1)
}, 30_000)

