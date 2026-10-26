/** Held-out steps 80.1–80.5: the ticket check over a folder, a subtree root and a spec. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

type T = { title: string; cites: string; blocked_by: string; stories: string; touches?: string; what?: string; noWhatHeading?: boolean }

const ticketText = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked_by}`,
    `stories: ${t.stories}`,
    ...(t.touches === undefined ? [] : [`touches: ${t.touches}`]),
    '',
    ...(t.noWhatHeading ? [] : ['## What to build', '']),
    t.what ?? 'A person sees the change in the map.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The change shows in the map.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

function project(decided: string[], stories: number[]): Project {
  p = makeProject()
  const log = logOf(
    proposed('map', { status: 'open' }), accepted('map'),
    ...decided.map((id) => proposed(id, { status: 'decided', parent: 'map' })),
    ...decided.map((id) => accepted(id)),
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  mkdirSync(join(p.dir, 'tickets'))
  const spec = ['# Spec', '', '## User Stories', '', ...stories.map((n) => `${n}. As a person, I want thing ${n}, so that it works.`), '']
  writeFileSync(join(p.dir, 'spec.md'), spec.join('\n'))
  return p
}

const write = (name: string, t: T) => writeFileSync(join(p.dir, 'tickets', name), ticketText(t))
const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const failLines = (out: string) => out.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check:'))

test('80.1 a folder of valid tickets passes the ticket check', () => {
  project(['map-reopen', 'map-stale'], [1, 2, 3])
  write('01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', blocked_by: '', stories: '1, 2', touches: 'map view' })
  write('02-stale.md', { title: 'Mark the stale cards', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' })
  const r = check()
  expect(failLines(r.stdout)).toEqual([])
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.code).toBe(0)
})

function validThree() {
  project(['map-reopen', 'map-stale', 'map-later'], [1, 2, 3])
  write('01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', blocked_by: '', stories: '1', touches: 'map view' })
  write('02-stale.md', { title: 'Mark the stale cards', cites: 'map-stale', blocked_by: '1', stories: '2', touches: 'decision log' })
  write('03-later.md', { title: 'Later work', cites: 'map-later', blocked_by: '', stories: '3', touches: 'stale marks' })
}

test('80.2 a missing touches line and a path in the body fail their own checks by name', () => {
  validThree()
  expect(check().code).toBe(0)
  write('02-stale.md', { title: 'Mark the stale cards', cites: 'map-stale', blocked_by: '1', stories: '2' })
  const t3 = join(p.dir, 'tickets', '03-later.md')
  const lines = readFileSync(t3, 'utf8').split('\n')
  const at = lines.indexOf('## What to build') + 2
  lines.splice(at, 0, 'edit src/loop.ts')
  writeFileSync(t3, lines.join('\n'))
  const pathLine = at + 1
  write('01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', blocked_by: '', stories: '1', touches: 'map view, server/routes' })
  const r = check()
  const out = failLines(r.stdout)
  expect(out.some((l) => l.startsWith('02-stale.md: shape: touches:'))).toBe(true)
  expect(out.some((l) => l.startsWith('03-later.md: no-file-paths:') && l.includes('"src/loop.ts"') && l.includes(`line ${pathLine}`))).toBe(true)
  expect(out.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  project(['map-reopen', 'map-stale'], [1, 2, 3])
  write('01-reopen.md', { title: 'Reopen', cites: 'map-reopen', blocked_by: '', stories: '1', touches: 'map view' })
  write('02-stale.md', { title: 'Stale', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' })
  write('03-more.md', { title: 'More', cites: 'map-reopen', blocked_by: '', stories: '2', touches: 'stale marks' })
  write('04-after.md', { title: 'After', cites: 'map-reopen', blocked_by: '2', stories: '2', touches: 'fold' })
  expect(check().code).toBe(0)
  write('02-stale.md', { title: 'Stale', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log', noWhatHeading: true })
  const r = check()
  const out = failLines(r.stdout)
  expect(out.some((l) => l.startsWith('02-stale.md: shape: What to build:'))).toBe(true)
  expect(out).toContain('ticket set: cards-cited: cites: no ticket cites the decided card #map-stale')
  expect(out).toContain('ticket set: stories: stories: no ticket delivers story 3')
  expect(out.some((l) => l.startsWith('04-after.md: blocked_by:') && l.includes('2'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  project(['map-reopen', 'map-stale'], [1, 2, 3, 4])
  write('01-a.md', { title: 'A', cites: 'map-stale', blocked_by: '', stories: '1, 9', touches: 'map view' })
  write('02-b.md', { title: 'B', cites: 'map-stale', blocked_by: '3', stories: '2', touches: 'decision log' })
  write('03-c.md', { title: 'C', cites: 'map-stale', blocked_by: '2', stories: '3', touches: 'stale marks' })
  write('04-d.md', { title: 'D', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'fold' })
  write('05-e.md', { title: 'E', cites: 'map-stale', blocked_by: '8', stories: '3', touches: 'board' })
  const r = check()
  const out = failLines(r.stdout)
  expect(out.some((l) => l.includes('cards-cited') && l.includes('#map-reopen'))).toBe(true)
  expect(out.some((l) => l.includes('stories') && l.includes('no ticket delivers story 4'))).toBe(true)
  expect(out.some((l) => l.includes('stories') && l.includes('story 9'))).toBe(true)
  const blocked = out.filter((l) => l.includes(': blocked_by: '))
  expect(blocked.some((l) => l.startsWith('02-b.md') && l.includes('cycle'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('03-c.md') && l.includes('cycle'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('05-e.md') && l.includes('8'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('01-a.md') || l.startsWith('04-d.md'))).toBe(false)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next ticket check passes', () => {
  project(['map-reopen', 'map-stale'], [1, 2, 3])
  write('01-reopen.md', { title: 'Reopen', cites: 'map-reopen', blocked_by: '', stories: '1', touches: 'map view' })
  write('02-stale.md', { title: 'Stale', cites: 'map-stale', blocked_by: '1', stories: '2', touches: 'decision log' })
  const first = check()
  expect(failLines(first.stdout)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  write('02-stale.md', { title: 'Stale', cites: 'map-stale', blocked_by: '1', stories: '2, 3', touches: 'decision log' })
  const r = check()
  expect(failLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})


