import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => p?.run(['git', 'worktree', 'prune']))

const PLAN = '.werk/plans/map'
const SPEC = readFileSync(join(import.meta.dir, '../../src/test/fixtures/tickets/spec.md'), 'utf8')
const TICKET = [
  'title: A person can reopen a card and see the stale marks',
  'cites: map-reopen, map-stale, #map',
  'blocked_by:',
  'stories: 1, 2, 3',
  'touches: map view',
  '',
  '## What to build',
  '',
  'A person reopens a decided card and the cards below it show a stale mark.',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] A reopened card shows as open.',
  '',
  '## Checks',
  '',
  '- `make check`',
  '',
].join('\n')

const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })
const reply = (object: unknown, before: FakeStep[] = []): FakeReply => ({
  steps: [...before, { event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: `Done.\n${JSON.stringify(object)}` } }],
})

test('98.2 every agent of a full build and plan shows its role in the launch record', () => {
  p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), 'check:\n\t@true\n')
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  mkdirSync(join(p.dir, '.werk'))
  const log = logOf(
    proposed('map', { status: 'decided', who: 'you' }),
    proposed('map-reopen', { status: 'decided', parent: 'map' }),
    proposed('map-stale', { status: 'decided', parent: 'map' }),
    accepted('map-reopen'),
    accepted('map-stale'),
  )
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')

  const toolUse = { event: { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'make check' } }] } } }
  const toolResult = { event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } } }
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, '[]')] },
      'ticket-writer': { steps: [edit(`${PLAN}/tickets/01-reopen.md`, TICKET), edit(`${PLAN}/tickets.answers.json`, '[]')] },
      builder: reply({}, [toolUse, { sleep: 800 }, toolResult, edit('feature.txt', 'feature\n')]),
      grader: reply({ lines: ['ac-1', '#map', '#map-reopen', '#map-stale'].map((id) => ({ id, score: 4, gap: 'none' })) }),
      ...Object.fromEntries(['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => [`reviewer-${a}`, reply({ findings: [] })])),
      'loop-classifier': { steps: [{ event: { type: 'result', subtype: 'success', result: 'progressing' } }] },
      'heldout-author': reply({ steps: [{ text: 'Given a map\nWhen the person reopens a card\nThen the card is open' }] }),
      'heldout-binder': reply({ steps: [{ id: '1.1', cmd: 'true' }] }),
    },
  })

  const plan = p.werk(['plan', 'map'])
  expect(plan.code).toBe(0)
  const run = p.werk(['run', 'map', '--loop-every', '150'])
  expect(run.stdout + run.stderr).toContain('merge')
  expect(run.code).toBe(0)
  expect(p.run(['git', 'log', '--first-parent', '--format=%s', 'main']).stdout).toMatch(/werk: merge ticket 1/)

  const roles = p.agentRoles()
  const count = (pred: (r: string) => boolean) => roles.filter((r) => r !== undefined && pred(r)).length
  expect(count((r) => r === 'spec-writer')).toBe(1)
  expect(count((r) => r === 'ticket-writer')).toBe(1)
  expect(count((r) => r === 'builder')).toBe(1)
  expect(count((r) => r === 'grader')).toBe(1)
  expect(count((r) => r.startsWith('reviewer'))).toBe(5)
  expect(count((r) => r === 'loop-classifier')).toBeGreaterThanOrEqual(1)
  expect(count((r) => r === 'heldout-author')).toBeGreaterThanOrEqual(1)
  expect(count((r) => r === 'heldout-binder')).toBeGreaterThanOrEqual(1)
  // each raw entry of the launch record holds the role next to the arguments of that launch
  const raw = readFileSync(p.env.WERK_FAKE_AGENT_LOG!, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  for (const entry of raw) {
    expect(Array.isArray(entry.argv)).toBe(true)
    expect(typeof entry.role).toBe('string')
  }
}, 120_000)
