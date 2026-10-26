/** Held-out step 98.2: every agent of a full plan and build shows its role in the launch record. */
import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FakeReply, FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

const PLAN = '.werk/plans/map'
const SPEC = '# Spec: reopen a card\n\n## Problem Statement\n\nA person cannot reopen a decided card.\n\n## User Stories\n\n1. As a person, I want to reopen a decided card, so that I can change my mind.\n\n## Implementation Decisions\n\n1. Not a story.\n'
const TICKET = `title: A person can reopen a decided card from the map
cites: map-reopen, #map
blocked_by:
stories: 1
touches: map view

## What to build

A person opens a decided card and presses reopen.

## Acceptance criteria

- [ ] A reopened card shows as open in the map.

## Checks

- \`make check\`
`
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })
const result = (text = 'Done.') => ({ event: { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1, result: text } })
const judge = (object: unknown): FakeReply => ({ steps: [result(`Done.\n${JSON.stringify(object)}`)] })
const toolUse = (id: string) => ({ event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: 'make check' } }] } } })
const toolResult = (id: string) => ({ event: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } } })
const REVIEWERS = ['design', 'maintainability', 'tests', 'security', 'performance'].map((a) => `reviewer-${a}`)

test('98.2 every agent of a full build and plan shows its role in the launch record', () => {
  const p = makeProject()
  writeFileSync(join(p.dir, 'Makefile'), 'check:\n\t@test -f feature.txt || { echo missing; exit 1; }\n')
  p.run(['git', 'add', 'Makefile'])
  p.run(['git', 'commit', '--quiet', '-m', 'Add the check'])
  mkdirSync(join(p.dir, '.werk'))
  const log = logOf(
    proposed('map', { status: 'decided', who: 'you' }),
    proposed('map-reopen', { status: 'decided', parent: 'map' }),
    accepted('map-reopen'),
  )
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')

  const graded = judge({ lines: ['ac-1', '#map-reopen', '#map'].map((id) => ({ id, score: 4, gap: 'none' })) })
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, '[]')] },
      'ticket-writer': { steps: [edit(`${PLAN}/tickets/01-reopen.md`, TICKET), edit(`${PLAN}/tickets.answers.json`, '[]')] },
      // The builder works with a tool call in flight long enough for the loop classifier to look.
      builder: { steps: [toolUse('t1'), { sleep: 1500 }, toolResult('t1'), edit('feature.txt', 'done\n'), result()] },
      grader: graded,
      ...Object.fromEntries(REVIEWERS.map((r) => [r, judge({ findings: [] })])),
      'loop-classifier': { steps: [result('progressing')] },
      'heldout-author': judge({ steps: [{ text: 'Given a decided card\nWhen the person reopens it\nThen the card shows as open' }] }),
      'heldout-binder': judge({ steps: [{ id: '1.1', cmd: 'true' }] }),
    },
  })

  const plan = p.werk(['plan', 'map'])
  if (plan.code !== 0) console.log(plan.stdout, plan.stderr)
  expect(plan.code).toBe(0)
  const run = p.werk(['run', 'map', '--parallel', '1', '--loop-every', '300'])
  console.log(run.stdout, run.stderr)
  expect(run.stdout).toMatch(/merge|merged/)

  const roles = p.agentRoles()
  const count = (pred: (r: string) => boolean) => roles.filter((r) => r !== undefined && pred(r)).length
  expect(count((r) => r === 'spec-writer')).toBe(1)
  expect(count((r) => r === 'ticket-writer')).toBe(1)
  const builders = count((r) => r === 'builder')
  expect(builders).toBeGreaterThanOrEqual(1)
  expect(count((r) => r === 'grader')).toBe(builders)
  expect(count((r) => r.startsWith('reviewer'))).toBe(5)
  expect(count((r) => r === 'loop-classifier')).toBeGreaterThanOrEqual(1)
  expect(count((r) => r === 'heldout-author')).toBeGreaterThanOrEqual(1)
  expect(count((r) => r === 'heldout-binder')).toBeGreaterThanOrEqual(1)
  // Each entry of the launch record holds the role beside the arguments of that launch.
  const entries = readFileSync(join(dirname(p.dir), 'agent-launches.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  expect(entries).toHaveLength(roles.length)
  for (const e of entries) {
    expect(typeof e.role).toBe('string')
    expect(Array.isArray(e.argv)).toBe(true)
  }
  expect(run.code).toBe(0)
}, 120_000)
