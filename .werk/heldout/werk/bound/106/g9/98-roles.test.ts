/** Held-out steps 98.1, 98.2, 98.4 and 98.5: each agent gets the reply that the script holds for its role. */
import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply, FakeScript } from '../../src/test/fake-agent.ts'
import { makeProject } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
import { branchOf, buildProject, git, grading, judgeReply, prompts, REVIEWERS, reviewing, runRecord } from './lib.ts'

const LINES = ['ac-1', '#loop']
const BUILDER_MARK = 'BUILDER-REPLY-MARK'
const GRADER_MARK = 'GRADER-REPLY-MARK'
const builderReply: FakeReply = {
  steps: [
    { event: { type: 'assistant', message: { content: [{ type: 'text', text: BUILDER_MARK }] } } },
    { edit: { path: 'done.txt', content: 'done\n' } },
    { event: { type: 'result', subtype: 'success', total_cost_usd: 0.1, num_turns: 1, result: BUILDER_MARK } },
  ],
  exit: 0,
}
const graderReply = grading(LINES, () => 4, () => GRADER_MARK)
const script = (): FakeScript => ({
  steps: [],
  roles: { builder: builderReply, grader: graderReply, ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])) },
})
const sessionText = (dir: string) => readFileSync(join(dir, '.werk', 'sessions', '3.jsonl'), 'utf8')

test('98.1 a build pass and its grader each get the reply scripted for their role', () => {
  const p = buildProject()
  p.scriptAgent(script())
  const r = p.werk(['build', '3'])
  for (const prompt of [...prompts(p, 'builder'), ...prompts(p, 'grader')]) {
    expect(prompt).not.toContain(BUILDER_MARK)
    expect(prompt).not.toContain(GRADER_MARK)
  }
  const branch = branchOf(r.stdout)
  expect(git(p, 'show', `${branch}:done.txt`)).toBe('done')
  const [line] = runRecord(p)
  expect(line.grade.pass).toBe(true)
  expect(line.grade.lines.every((l: { gap: string }) => l.gap === GRADER_MARK)).toBe(true)
  // The builder's own session holds the builder reply and none of the grader reply.
  expect(sessionText(p.dir)).toContain(BUILDER_MARK)
  expect(sessionText(p.dir)).not.toContain(GRADER_MARK)
  // The grade came from the grader reply, so the grader did not play the builder reply.
  expect(JSON.stringify(line.grade)).not.toContain(BUILDER_MARK)
  expect(r.code).toBe(0)
}, 30_000)

test('98.4 a build pass with a permission ask plays one turn and exits with the script code', () => {
  const p = buildProject()
  const asking: FakeReply = {
    steps: [{ ask: { id: 'ask-1', tool: 'Bash', input: { command: 'touch done.txt' } } }, ...builderReply.steps],
    exit: 0,
  }
  const s = script()
  s.roles!.builder = asking
  p.scriptAgent(s)
  const started = performance.now()
  const r = p.werk(['build', '3', '--agent-timeout', '20000'])
  expect(performance.now() - started).toBeLessThan(20_000)
  const roles = p.agentRoles()
  const builderAt = roles.indexOf('builder')
  expect(roles.filter((x) => x === 'builder')).toHaveLength(1)
  const inputs = p.agentInputs()[builderAt]!
  expect(inputs.some((m) => (m as { type?: string }).type === 'control_response')).toBe(true)
  // One user message: the prompt. No second turn.
  expect(inputs.filter((m) => (m as { type?: string }).type === 'user')).toHaveLength(1)
  expect(sessionText(p.dir)).toContain('"type":"result"')
  const [line] = runRecord(p)
  expect(line.agentExit).toBe(0)
  expect(r.code).toBe(0)
}, 30_000)

test('98.5 a reworded prompt does not change which reply a role gets', () => {
  const first = buildProject()
  first.scriptAgent(script())
  const before = first.werk(['build', '3'])
  expect(before.code).toBe(0)

  const reworded = '## What to build\n\nCreate the file done.txt in the root.\n\n## Acceptance criteria\n\n- The root holds done.txt.'
  const second = buildProject({ ticket: { title: 'A new wording of the ticket', brief: reworded } })
  second.scriptAgent(script())
  const after = second.werk(['build', '3'])
  expect(prompts(second, 'builder')[0]).not.toBe(prompts(first, 'builder')[0])
  expect(prompts(second, 'builder')[0]).toContain('Create the file done.txt in the root.')
  expect(git(second, 'show', `${branchOf(after.stdout)}:done.txt`)).toBe('done')
  expect(sessionText(second.dir)).toContain(BUILDER_MARK)
  expect(runRecord(second)[0].grade.lines.every((l: { gap: string }) => l.gap === GRADER_MARK)).toBe(true)
  expect(after.code).toBe(before.code)
  expect(runRecord(second).map((l) => l.green)).toEqual(runRecord(first).map((l) => l.green))
}, 60_000)

const SPEC = '# Spec: one thing\n\n## Problem Statement\n\nNothing.\n\n## User Stories\n\n1. As a person, I want the thing, so that it is done.\n'
const TICKET = [
  'title: The thing is done',
  'cites: map-reopen, map',
  'blocked_by:',
  'stories: 1',
  'touches: map view',
  '',
  '## What to build',
  '',
  'Make done.txt.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] done.txt is there.',
  '',
  '## Checks',
  '',
  '- `make test`',
  '',
].join('\n')

test('98.2 every agent of a full build and plan shows its role in the launch record', () => {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), 'test:\n\t@true\n')
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  mkdirSync(join(p.dir, '.werk'))
  const log = logOf(proposed('map', { status: 'decided', who: 'you' }), proposed('map-reopen', { status: 'decided', parent: 'map' }), accepted('map-reopen'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const plan = '.werk/plans/map'
  const reply = (object: unknown): FakeReply => judgeReply(object)
  const toolUse = { event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } } }
  const toolResult = { event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } } }
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [{ edit: { path: `${plan}/spec.md`, content: SPEC } }, { edit: { path: `${plan}/spec.answers.json`, content: '[]' } }] },
      'ticket-writer': {
        steps: [{ edit: { path: `${plan}/tickets/01-thing.md`, content: TICKET } }, { edit: { path: `${plan}/tickets.answers.json`, content: '[]' } }],
      },
      builder: { steps: [toolUse, { sleep: 600 }, toolResult, { edit: { path: 'done.txt', content: 'done\n' } }, ...reply({}).steps] },
      grader: grading(['ac-1', '#map-reopen', '#map']),
      ...Object.fromEntries(REVIEWERS.map((r) => [r, reviewing()])),
      'loop-classifier': { steps: [{ event: { type: 'result', subtype: 'success', result: 'progressing' } }] },
      'heldout-author': reply({ steps: [{ text: 'Given the thing\nWhen the person looks\nThen it is done' }] }),
      'heldout-binder': reply({ steps: [{ id: '1.1', cmd: 'true' }] }),
    },
  })
  const planned = p.werk(['plan', 'map'])
  expect(planned.code).toBe(0)
  const ran = p.werk(['run', 'map', '--loop-every', '100'])
  const moves = readFileSync(join(p.dir, '.werk', 'board.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.type === 'ticket.moved').map((e) => e.payload.to)
  expect(moves).toContain('done')

  const launches = readFileSync(p.env.WERK_FAKE_AGENT_LOG!, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { argv: string[]; role?: string })
  const count = (role: string) => launches.filter((l) => l.role === role).length
  expect(count('spec-writer')).toBe(1)
  expect(count('ticket-writer')).toBe(1)
  expect(count('builder')).toBeGreaterThanOrEqual(1)
  expect(count('grader')).toBe(count('builder'))
  expect(launches.filter((l) => l.role?.startsWith('reviewer')).length).toBe(5)
  expect(count('loop-classifier')).toBeGreaterThanOrEqual(1)
  expect(count('heldout-author')).toBe(1)
  expect(count('heldout-binder')).toBeGreaterThanOrEqual(1)
  for (const l of launches) {
    expect(typeof l.role).toBe('string')
    expect(Array.isArray(l.argv)).toBe(true)
  }
}, 90_000)
