import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { project, type P } from '../lib.ts'
import { accepted, proposed } from '../../src/test/map-events.ts'

let p: P
afterEach(() => p?.cleanup())

type T = { n: number; slug: string; title?: string; cites: string; blockedBy?: string; stories: string; touches: string }

const ticketText = (t: T) =>
  [
    `title: ${t.title ?? `Ticket ${t.n}`}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blockedBy ?? ''}`,
    `stories: ${t.stories}`,
    `touches: ${t.touches}`,
    '',
    '## What to build',
    '',
    `A person does the thing of ticket ${t.n}.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The thing works.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

const spec = (n: number) =>
  ['# Spec', '', '## User Stories', '', ...Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`), '', '## Notes', ''].join('\n')

/** A map with the subtree root "map", open, and the decided cards under it. */
function setup(decided: string[], stories: number, tickets: T[]) {
  p = project()
  p.seed(proposed('map', { title: 'Map', status: 'open' }), accepted('map'), ...decided.flatMap((id) => [proposed(id, { title: id, status: 'decided', parent: 'map' }), accepted(id)]))
  writeFileSync(join(p.dir, 'spec.md'), spec(stories))
  mkdirSync(join(p.dir, 'tickets'))
  for (const t of tickets) writeFileSync(file(t.n, t.slug), ticketText(t))
}
const file = (n: number, slug: string) => join(p.dir, 'tickets', `${String(n).padStart(2, '0')}-${slug}.md`)
const check = () => p.w('ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md')
const failuresOf = (out: string) => out.split('\n').filter((l) => /^(ticket set|\S+): [\w-]+: /.test(l) && !l.startsWith('ticket-check:'))

test('80.1 a folder of valid tickets passes the ticket check', () => {
  setup(['map-reopen', 'map-stale'], 3, [
    { n: 1, slug: 'reopen', cites: 'map-reopen', stories: '1, 2', touches: 'map view' },
    { n: 2, slug: 'stale', cites: 'map-stale', blockedBy: '1', stories: '3', touches: 'decision log' },
  ])
  const r = check()
  expect(failuresOf(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})

test('80.2 a ticket with a missing touches line and a path in its body fails its own checks by name', () => {
  setup(['map-reopen', 'map-stale'], 3, [
    { n: 1, slug: 'one', cites: 'map-reopen', stories: '1', touches: 'map view' },
    { n: 2, slug: 'two', cites: 'map-stale', stories: '2', touches: 'decision log' },
    { n: 3, slug: 'three', cites: 'map-stale', stories: '3', touches: 'decision log' },
  ])
  expect(check().code).toBe(0)
  const t2 = file(2, 'two')
  writeFileSync(t2, readFileSync(t2, 'utf8').replace(/^touches:.*\n/m, ''))
  const t3 = file(3, 'three')
  const lines3 = readFileSync(t3, 'utf8').split('\n')
  const at = lines3.indexOf('## What to build') + 2
  lines3.splice(at, 0, 'edit src/loop.ts')
  writeFileSync(t3, lines3.join('\n'))
  const t1 = file(1, 'one')
  writeFileSync(t1, readFileSync(t1, 'utf8').replace(/^touches:.*$/m, 'touches: map view, server/routes'))

  const r = check()
  const f = failuresOf(r.stdout)
  expect(f.some((l) => l.startsWith('02-two.md: shape: touches'))).toBe(true)
  expect(f.some((l) => l.startsWith('03-three.md: no-file-paths:') && l.includes('src/loop.ts') && l.includes(`line ${at + 1}`))).toBe(true)
  expect(f.some((l) => l.startsWith('01-one.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  setup(['map-reopen', 'map-stale'], 3, [
    { n: 1, slug: 'one', cites: 'map-reopen', stories: '1, 2', touches: 'map view' },
    { n: 2, slug: 'two', cites: 'map-stale', stories: '3', touches: 'decision log' },
    { n: 4, slug: 'four', cites: 'map-reopen', blockedBy: '2', stories: '1', touches: 'map view' },
  ])
  const t2 = file(2, 'two')
  writeFileSync(t2, readFileSync(t2, 'utf8').replace('## What to build\n', ''))
  const r = check()
  const f = failuresOf(r.stdout)
  expect(f.some((l) => l.startsWith('02-two.md: shape:') && l.includes('What to build'))).toBe(true)
  expect(f.some((l) => l.includes('cards-cited') && l.includes('map-stale'))).toBe(true)
  expect(f.some((l) => l.includes('stories') && /story 3\b/.test(l) && l.includes('no ticket'))).toBe(true)
  expect(f.some((l) => l.startsWith('04-four.md: blocked_by:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 a ticket set with coverage and order errors names each card, story and ticket', () => {
  setup(['map-reopen', 'map-stale'], 4, [
    { n: 1, slug: 'one', cites: 'map-stale', stories: '1, 9', touches: 'map view' },
    { n: 2, slug: 'two', cites: 'map-stale', blockedBy: '3', stories: '2', touches: 'map view' },
    { n: 3, slug: 'three', cites: 'map-stale', blockedBy: '2', stories: '3', touches: 'map view' },
    { n: 4, slug: 'four', cites: 'map-stale', blockedBy: '1', stories: '1', touches: 'map view' },
    { n: 5, slug: 'five', cites: 'map-stale', blockedBy: '8', stories: '2', touches: 'map view' },
  ])
  const r = check()
  const f = failuresOf(r.stdout)
  expect(f.some((l) => l.includes('cards-cited') && l.includes('map-reopen'))).toBe(true)
  expect(f.some((l) => l.includes('stories') && /story 4\b/.test(l) && l.includes('no ticket'))).toBe(true)
  expect(f.some((l) => l.includes('stories') && /story 9\b/.test(l))).toBe(true)
  const blocked = f.filter((l) => / blocked_by: /.test(l))
  expect(blocked.some((l) => l.startsWith('02-two.md') && l.includes('cycle'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('03-three.md') && l.includes('cycle'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('05-five.md') && l.includes('8'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('01-one.md') || l.startsWith('04-four.md'))).toBe(false)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next ticket check passes', () => {
  setup(['map-reopen', 'map-stale'], 3, [
    { n: 1, slug: 'one', cites: 'map-reopen', stories: '1', touches: 'map view' },
    { n: 2, slug: 'two', cites: 'map-stale', stories: '2', touches: 'decision log' },
  ])
  const first = check()
  const f = failuresOf(first.stdout)
  expect(f.length).toBe(1)
  expect(f[0]).toContain('story 3')
  const t2 = file(2, 'two')
  writeFileSync(t2, readFileSync(t2, 'utf8').replace(/^stories:.*$/m, 'stories: 2, 3'))
  const r = check()
  expect(failuresOf(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})
