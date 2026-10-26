/** Feature 80: the ticket check on a folder of ticket files. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { accepted, makeProject, proposed, seed, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())

type T = { title: string; cites: string; blocked: string; stories: string; touches: string | null; what?: string | null }
/** A ticket file with the five header lines and the three sections in order. */
function ticketText(t: T): string {
  return [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked}`,
    `stories: ${t.stories}`,
    ...(t.touches === null ? [] : [`touches: ${t.touches}`]),
    '',
    ...(t.what === null ? [] : ['## What to build', '', t.what ?? 'A person reopens a decided card from the map, and it goes back to open.', '']),
    '## Acceptance criteria',
    '',
    '- [ ] The card shows as open in the map.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
}

function spec(n: number): string {
  return ['# Spec', '', '## User Stories', '', ...Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}, so that it works.`), ''].join('\n')
}

/** A map whose subtree under "map" holds the decided cards map-reopen and map-stale. The root itself is open. */
function project(stories: number, tickets: Record<string, T>) {
  p = makeProject()
  seed(
    p,
    proposed('map', { title: 'The map', status: 'open' }),
    accepted('map'),
    proposed('map-reopen', { title: 'Reopen', status: 'decided', parent: 'map' }),
    proposed('map-stale', { title: 'Stale', status: 'decided', parent: 'map' }),
    accepted('map-reopen'),
    accepted('map-stale'),
  )
  mkdirSync(join(p.dir, 'tickets'))
  writeFileSync(join(p.dir, 'spec.md'), spec(stories))
  for (const [name, t] of Object.entries(tickets)) writeFileSync(join(p.dir, 'tickets', name), ticketText(t))
}
const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const failureLines = (out: string) => out.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('ticket-check:'))

test('80.1 a folder of valid tickets passes the ticket check', () => {
  project(3, {
    '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blocked: '', stories: '1, 2', touches: 'map view' },
    '02-stale.md': { title: 'Mark the stale cards', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' },
  })
  const r = check()
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.code).toBe(0)
})

const passing = (): Record<string, T> => ({
  '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blocked: '', stories: '1', touches: 'map view' },
  '02-stale.md': { title: 'Mark the stale cards', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' },
  '03-loop.md': { title: 'Run the loop', cites: 'map-stale', blocked: '', stories: '3', touches: 'builder loop' },
})

test('80.2 a ticket with a missing touches line and a path in its body fails its own checks by name', () => {
  const tickets = passing()
  project(3, tickets)
  expect(check().code).toBe(0)
  tickets['02-stale.md']!.touches = null
  tickets['03-loop.md']!.what = 'Run the loop.\nThen edit src/loop.ts to add the cap.'
  tickets['01-reopen.md']!.touches = 'map view, server/routes'
  for (const [name, t] of Object.entries(tickets)) writeFileSync(join(p.dir, 'tickets', name), ticketText(t))
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines).toContainEqual(expect.stringMatching(/^02-stale\.md: shape: touches: /))
  const path = lines.find((l) => l.startsWith('03-loop.md: no-file-paths:'))
  expect(path).toBeDefined()
  expect(path!).toContain('src/loop.ts')
  expect(path!).toMatch(/line \d+/)
  expect(lines).toContainEqual(expect.stringMatching(/^01-reopen\.md: touches: /))
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  project(3, {
    '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blocked: '', stories: '1, 2', touches: 'map view' },
    '02-stale.md': { title: 'Mark the stale cards', cites: 'map-stale', blocked: '', stories: '3', touches: 'decision log', what: null },
    '03-other.md': { title: 'Another ticket', cites: 'map-reopen', blocked: '', stories: '1', touches: 'map view' },
    '04-after.md': { title: 'After the stale marks', cites: 'map-reopen', blocked: '2', stories: '2', touches: 'map view' },
  })
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines).toContainEqual(expect.stringMatching(/^02-stale\.md: shape: What to build: /))
  expect(lines).toContainEqual(expect.stringMatching(/cards-cited.*#?map-stale/))
  expect(lines).toContainEqual(expect.stringMatching(/stories.*story 3/))
  expect(lines).toContainEqual(expect.stringMatching(/^04-after\.md: blocked_by: .*not a ticket in the set/))
  expect(r.code).not.toBe(0)
})

test('80.4 a ticket set with coverage and order errors names each card, story and ticket', () => {
  project(4, {
    '01-one.md': { title: 'Ticket one', cites: 'map-stale', blocked: '', stories: '1, 9', touches: 'map view' },
    '02-two.md': { title: 'Ticket two', cites: 'map-stale', blocked: '3', stories: '2', touches: 'map view' },
    '03-three.md': { title: 'Ticket three', cites: 'map-stale', blocked: '2', stories: '3', touches: 'map view' },
    '04-four.md': { title: 'Ticket four', cites: 'map-stale', blocked: '1', stories: '3', touches: 'map view' },
    '05-five.md': { title: 'Ticket five', cites: 'map-stale', blocked: '8', stories: '1', touches: 'map view' },
  })
  const r = check()
  const lines = failureLines(r.stdout)
  console.log(lines.join('\n'))
  expect(lines).toContainEqual(expect.stringMatching(/cards-cited.*#?map-reopen/))
  expect(lines).toContainEqual(expect.stringMatching(/story 4/))
  expect(lines).toContainEqual(expect.stringMatching(/story 9/))
  const blocked = lines.filter((l) => /^\S+: blocked_by: /.test(l))
  expect(blocked).toContainEqual(expect.stringMatching(/^02-two\.md: blocked_by: .*cycle/))
  expect(blocked).toContainEqual(expect.stringMatching(/^03-three\.md: blocked_by: .*cycle/))
  expect(blocked).toContainEqual(expect.stringMatching(/^05-five\.md: blocked_by: .*8/))
  expect(blocked.some((l) => l.startsWith('01-one.md') || l.startsWith('04-four.md'))).toBe(false)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next ticket check passes', () => {
  const tickets = passing()
  tickets['02-stale.md']!.stories = '2'
  tickets['03-loop.md']!.stories = '2'
  project(3, tickets)
  const first = check()
  expect(first.code).not.toBe(0)
  expect(failureLines(first.stdout)).toEqual([expect.stringMatching(/story 3/)])
  const file = join(p.dir, 'tickets', '02-stale.md')
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^stories: .*$/m, 'stories: 2, 3'))
  const r = check()
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})
