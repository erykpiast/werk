import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acc, project, prop, type P } from './helpers.ts'

let p: P | undefined
afterEach(() => p?.cleanup())

type T = { n: number; slug: string; title: string; cites: string; blocked: string; stories: string; touches: string; build?: string }

const ticketText = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked}`,
    `stories: ${t.stories}`,
    `touches: ${t.touches}`,
    '',
    '## What to build',
    '',
    t.build ?? `Build the part for ${t.title.toLowerCase()}.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The person sees the change.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

const fileOf = (t: T) => `${String(t.n).padStart(2, '0')}-${t.slug}.md`

/** A map whose subtree under "map" holds the decided cards, a spec, and a ticket folder. */
function setup(decided: string[], stories: number[], tickets: T[]): P {
  const log = [prop('map', 'The map', { status: 'open' }), ...decided.flatMap((id) => [prop(id, `Card ${id}`, { status: 'decided', parent: 'map' })]), ...decided.map(acc)]
  p = project(log)
  const spec = ['# Spec', '', '## Problem Statement', '', 'A problem.', '', '## User Stories', '', ...stories.map((n) => `${n}. As a person, I want thing ${n}, so that it works.`), '', '## Implementation Decisions', '', 'None.', ''].join('\n')
  writeFileSync(join(p.dir, 'spec.md'), spec)
  mkdirSync(join(p.dir, 'tickets'))
  for (const t of tickets) writeFileSync(join(p.dir, 'tickets', fileOf(t)), ticketText(t))
  return p
}

const check = () => p!.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const edit = (t: T, f: (text: string) => string) => {
  const path = join(p!.dir, 'tickets', fileOf(t))
  writeFileSync(path, f(readFileSync(path, 'utf8')))
}
const failureLines = (stdout: string) => stdout.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check:'))

const t1: T = { n: 1, slug: 'reopen', title: 'A person reopens a card', cites: 'map-reopen', blocked: '', stories: '1, 2', touches: 'map view' }
const t2: T = { n: 2, slug: 'stale', title: 'A card shows a stale mark', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' }

test('80.1', () => {
  setup(['map-reopen', 'map-stale'], [1, 2, 3], [t1, t2])
  const r = check()
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.stdout).toMatch(/0 failure\(s\)/)
  expect(r.code).toBe(0)
})

const t3: T = { n: 3, slug: 'third', title: 'A third slice', cites: '', blocked: '1', stories: '3', touches: 'fold' }

test('80.2', () => {
  setup(['map-reopen', 'map-stale'], [1, 2, 3], [t1, t2, t3])
  expect(check().code).toBe(0) // the Given: the set passes every check together
  edit(t2, (x) => x.replace(/^touches:.*\n/m, ''))
  edit(t3, (x) => x.replace('## What to build\n\n', '## What to build\n\nedit src/loop.ts\n'))
  edit(t1, (x) => x.replace(/^touches:.*$/m, 'touches: map view, server/routes'))
  const r = check()
  const lines = failureLines(r.stdout)
  const lineNo = readFileSync(join(p!.dir, 'tickets', fileOf(t3)), 'utf8').split('\n').indexOf('edit src/loop.ts') + 1
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: touches:'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-third.md: no-file-paths:') && l.includes('"src/loop.ts"') && l.includes(`line ${lineNo}`))).toBe(true)
  expect(lines.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3', () => {
  const a: T = { ...t1, stories: '1, 2' }
  const b: T = { ...t2, blocked: '' }
  const d: T = { n: 4, slug: 'after', title: 'A slice after the stale mark', cites: '', blocked: '2', stories: '', touches: 'map view' }
  setup(['map-reopen', 'map-stale'], [1, 2, 3], [a, b, d])
  edit(b, (x) => x.replace('## What to build\n', ''))
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: What to build:') && /missing/.test(l))).toBe(true)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('#map-stale'))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && l.includes('story 3'))).toBe(true)
  expect(lines.some((l) => l.startsWith('04-after.md: blocked_by:') && l.includes('not a ticket in the set'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4', () => {
  const tickets: T[] = [
    { n: 1, slug: 'one', title: 'Ticket one', cites: 'map-stale', blocked: '', stories: '1, 9', touches: 'map view' },
    { n: 2, slug: 'two', title: 'Ticket two', cites: '', blocked: '3', stories: '2', touches: 'map view' },
    { n: 3, slug: 'three', title: 'Ticket three', cites: '', blocked: '2', stories: '3', touches: 'map view' },
    { n: 4, slug: 'four', title: 'Ticket four', cites: '', blocked: '1', stories: '', touches: 'map view' },
    { n: 5, slug: 'five', title: 'Ticket five', cites: '', blocked: '8', stories: '', touches: 'map view' },
  ]
  setup(['map-reopen', 'map-stale'], [1, 2, 3, 4], tickets)
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('#map-reopen'))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && l.includes('story 4') && !l.includes('story 9'))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && l.includes('story 9'))).toBe(true)
  expect(lines.some((l) => l.startsWith('02-two.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-three.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('05-five.md: blocked_by:') && l.includes('8'))).toBe(true)
  expect(lines.filter((l) => /^0[14]-\w+\.md: blocked_by:/.test(l))).toEqual([])
  expect(r.code).not.toBe(0)
})

test('80.5', () => {
  const b: T = { ...t2, stories: '' }
  setup(['map-reopen', 'map-stale'], [1, 2, 3], [t1, b])
  const first = check()
  expect(failureLines(first.stdout)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  // The agent changes ticket 2 to list story 3, on the person's request.
  edit(b, (x) => x.replace(/^stories:.*$/m, 'stories: 3'))
  const r = check()
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})
