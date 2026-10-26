/** Held-out steps 80.1–80.5: the ticket check verb, run as a process. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

type T = { title: string; cites: string; blocked_by?: string; stories: string; touches: string; build?: string }
const ticket = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked_by ?? ''}`,
    `stories: ${t.stories}`,
    `touches: ${t.touches}`,
    '',
    '## What to build',
    '',
    t.build ?? 'A person does the thing and sees the result.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The result shows.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

function setup(decided: string[], stories: number, tickets: Record<string, T>): Project {
  p = makeProject()
  const events = [proposed('map', { status: 'open' }), ...decided.map((d) => proposed(d, { status: 'decided', parent: 'map' })), accepted('map'), ...decided.map(accepted)]
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), logOf(...events).map((e) => JSON.stringify(e)).join('\n') + '\n')
  const lines = ['# Spec', '', '## User Stories', '']
  for (let i = 1; i <= stories; i++) lines.push(`${i}. As a person, I want thing ${i}, so that it works.`)
  lines.push('', '## Implementation Decisions', '', '1. Not a story.', '')
  writeFileSync(join(p.dir, 'spec.md'), lines.join('\n'))
  mkdirSync(join(p.dir, 'tickets'))
  for (const [name, t] of Object.entries(tickets)) writeFileSync(join(p.dir, 'tickets', name), ticket(t))
  return p
}
const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const edit = (name: string, f: (s: string) => string) => {
  const path = join(p.dir, 'tickets', name)
  writeFileSync(path, f(readFileSync(path, 'utf8')))
}

test('80.1 a folder of valid tickets passes the ticket check', () => {
  setup(['map-reopen', 'map-stale'], 3, {
    '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' },
    '02-stale.md': { title: 'Show stale marks', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' },
  })
  const r = check()
  console.log(r.stdout, r.stderr)
  expect(r.stdout).not.toMatch(/^(?!ticket-check: ).+: .+: /m)
  expect(r.stdout).toContain('0 failure(s) in all')
  expect(r.code).toBe(0)
})

const three = (): Record<string, T> => ({
  '01-a.md': { title: 'Ticket one', cites: 'map-reopen', stories: '1', touches: 'map view' },
  '02-b.md': { title: 'Ticket two', cites: 'map-stale', blocked_by: '1', stories: '2', touches: 'decision log' },
  '03-c.md': { title: 'Ticket three', cites: 'map-reopen', blocked_by: '2', stories: '3', touches: 'stale marks' },
})

test('80.2 own-check failures are named per ticket', () => {
  setup(['map-reopen', 'map-stale'], 3, three())
  expect(check().code).toBe(0)
  edit('02-b.md', (s) => s.replace(/^touches:.*\n/m, ''))
  edit('03-c.md', (s) => s.replace('## What to build\n\n', '## What to build\n\nedit src/loop.ts\n'))
  edit('01-a.md', (s) => s.replace(/^touches:.*$/m, 'touches: map view, server/routes'))
  const r = check()
  console.log(r.stdout)
  expect(r.stdout).toMatch(/^02-b\.md: shape: touches: /m)
  expect(r.stdout).toMatch(/^03-c\.md: no-file-paths: .*line \d+ .*"src\/loop\.ts"/m)
  expect(r.stdout).toMatch(/^01-a\.md: touches: /m)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  setup(['map-reopen', 'map-stale'], 3, {
    '01-a.md': { title: 'Ticket one', cites: 'map-reopen', stories: '1, 2', touches: 'map view' },
    '02-b.md': { title: 'Ticket two', cites: 'map-stale', stories: '3', touches: 'decision log' },
    '04-d.md': { title: 'Ticket four', cites: 'map-reopen', blocked_by: '2', stories: '1', touches: 'stale marks' },
  })
  expect(check().code).toBe(0)
  edit('02-b.md', (s) => s.replace('## What to build\n', ''))
  const r = check()
  console.log(r.stdout)
  expect(r.stdout).toMatch(/^02-b\.md: shape: What to build: /m)
  expect(r.stdout).toMatch(/cards-cited: .*map-stale/)
  expect(r.stdout).toMatch(/stories: .*story 3/)
  expect(r.stdout).toMatch(/^04-d\.md: blocked_by: .*not a ticket in the set/m)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  setup(['map-reopen', 'map-stale'], 4, {
    '01-a.md': { title: 'Ticket one', cites: 'map-stale', stories: '1, 9', touches: 'map view' },
    '02-b.md': { title: 'Ticket two', cites: 'map-stale', blocked_by: '3', stories: '2', touches: 'map view' },
    '03-c.md': { title: 'Ticket three', cites: 'map-stale', blocked_by: '2', stories: '3', touches: 'map view' },
    '04-d.md': { title: 'Ticket four', cites: 'map-stale', blocked_by: '1', stories: '1', touches: 'map view' },
    '05-e.md': { title: 'Ticket five', cites: 'map-stale', blocked_by: '8', stories: '2', touches: 'map view' },
  })
  const r = check()
  console.log(r.stdout)
  expect(r.stdout).toMatch(/cards-cited: .*map-reopen/)
  expect(r.stdout).toMatch(/stories: .*no ticket delivers story 4/)
  expect(r.stdout).toMatch(/stories: .*story 9/)
  expect(r.stdout).toMatch(/^02-b\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^03-c\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^05-e\.md: blocked_by: .*8/m)
  expect(r.stdout).not.toMatch(/^0[14]-.\.md: blocked_by:/m)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket and the next check passes', () => {
  setup(['map-reopen', 'map-stale'], 3, {
    '01-a.md': { title: 'Ticket one', cites: 'map-reopen', stories: '1', touches: 'map view' },
    '02-b.md': { title: 'Ticket two', cites: 'map-stale', blocked_by: '1', stories: '2', touches: 'decision log' },
  })
  const before = check()
  expect(before.code).not.toBe(0)
  expect(before.stdout.trimEnd().split('\n').slice(0, -1)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  edit('02-b.md', (s) => s.replace(/^stories:.*$/m, 'stories: 2, 3'))
  const r = check()
  expect(r.stdout).toContain('0 failure(s) in all')
  expect(r.code).toBe(0)
})
