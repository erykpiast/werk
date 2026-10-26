import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { accepted, project, proposed, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

type T = { title: string; cites: string; blockedBy: string; stories: string; touches: string; what?: string }

const ticketText = (t: T) => `title: ${t.title}
cites: ${t.cites}
blocked_by: ${t.blockedBy}
stories: ${t.stories}
touches: ${t.touches}

## What to build

${t.what ?? 'A person sees the change in the map.'}

## Acceptance criteria

- [ ] The change shows in the map.

## Checks

- \`make test\`
`

const SPEC = (n: number) => `# Spec

## User Stories

${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}, so that it works.`).join('\n')}

## Implementation Decisions

1. Not a story.
`

/** A map with the subtree "map" (open root) and its decided cards; the tickets folder and the spec. */
function setup(decided: string[], stories: number, tickets: Record<string, T>) {
  p = project()
  p.writeLog([
    proposed('map', { status: 'open' }),
    ...decided.map((id) => proposed(id, { status: 'decided', parent: 'map' })),
    ...decided.map((id) => accepted(id)),
    accepted('map'),
  ])
  mkdirSync(join(p.dir, 'tickets'))
  writeFileSync(join(p.dir, 'spec.md'), SPEC(stories))
  for (const [name, t] of Object.entries(tickets)) writeFileSync(join(p.dir, 'tickets', name), ticketText(t))
}
const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const failureLines = (out: string) => out.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check:'))
const file = (name: string) => join(p.dir, 'tickets', name)
const editFile = (name: string, f: (s: string) => string) => writeFileSync(file(name), f(readFileSync(file(name), 'utf8')))

test('80.1 a folder of valid tickets passes the ticket check', () => {
  setup(['map-reopen', 'map-stale'], 3, {
    '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blockedBy: '', stories: '1, 2', touches: 'map view' },
    '02-stale.md': { title: 'Show a stale mark', cites: 'map-stale', blockedBy: '1', stories: '3', touches: 'decision log' },
  })
  const r = check()
  expect(failureLines(r.stdout + r.stderr)).toEqual([])
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.code).toBe(0)
})

const threeTickets = (): Record<string, T> => ({
  '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blockedBy: '', stories: '1', touches: 'map view' },
  '02-stale.md': { title: 'Show a stale mark', cites: 'map-stale', blockedBy: '1', stories: '2', touches: 'decision log' },
  '03-loop.md': { title: 'Run the loop', cites: '', blockedBy: '2', stories: '3', touches: 'build loop' },
})

test('80.2 own checks fail by name', () => {
  setup(['map-reopen', 'map-stale'], 3, threeTickets())
  expect(check().code).toBe(0)
  editFile('02-stale.md', (s) => s.replace(/^touches:.*\n/m, ''))
  editFile('03-loop.md', (s) => s.replace('A person sees the change in the map.', 'A person sees the change in the map.\nedit src/loop.ts'))
  const pathLine = readFileSync(file('03-loop.md'), 'utf8').split('\n').indexOf('edit src/loop.ts') + 1
  editFile('01-reopen.md', (s) => s.replace('touches: map view', 'touches: map view, server/routes'))
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: touches'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-loop.md: no-file-paths:') && l.includes('src/loop.ts') && l.includes(`line ${pathLine}`))).toBe(true)
  expect(lines.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  setup(['map-reopen', 'map-stale'], 3, {
    '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blockedBy: '', stories: '1, 2', touches: 'map view' },
    '02-stale.md': { title: 'Show a stale mark', cites: 'map-stale', blockedBy: '1', stories: '3', touches: 'decision log' },
    '03-more.md': { title: 'More map work', cites: 'map-reopen', blockedBy: '1', stories: '1', touches: 'map view' },
    '04-after.md': { title: 'After the stale mark', cites: '', blockedBy: '2', stories: '2', touches: 'map view' },
  })
  expect(check().code).toBe(0)
  editFile('02-stale.md', (s) => s.replace('## What to build\n', ''))
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape:') && l.includes('What to build'))).toBe(true)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('map-stale'))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && /story 3\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('04-after.md: blocked_by:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  setup(['map-reopen', 'map-stale'], 4, {
    '01-a.md': { title: 'Ticket one', cites: 'map-stale', blockedBy: '', stories: '1, 9', touches: 'map view' },
    '02-b.md': { title: 'Ticket two', cites: '', blockedBy: '3', stories: '2', touches: 'map view' },
    '03-c.md': { title: 'Ticket three', cites: '', blockedBy: '2', stories: '3', touches: 'map view' },
    '04-d.md': { title: 'Ticket four', cites: '', blockedBy: '1', stories: '', touches: 'map view' },
    '05-e.md': { title: 'Ticket five', cites: '', blockedBy: '8', stories: '', touches: 'map view' },
  })
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('map-reopen'))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && /story 4\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && /story 9\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('02-b.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-c.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('05-e.md: blocked_by:') && l.includes('8'))).toBe(true)
  const blocked = lines.filter((l) => l.includes(': blocked_by:'))
  expect(blocked.some((l) => l.startsWith('01-a.md') || l.startsWith('04-d.md'))).toBe(false)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket and the next ticket check passes', () => {
  setup(['map-reopen', 'map-stale'], 3, {
    '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blockedBy: '', stories: '1', touches: 'map view' },
    '02-stale.md': { title: 'Show a stale mark', cites: 'map-stale', blockedBy: '1', stories: '2', touches: 'decision log' },
  })
  const first = check()
  const firstFailures = failureLines(first.stdout)
  expect(firstFailures).toHaveLength(1)
  expect(firstFailures[0]).toContain('story 3')
  editFile('02-stale.md', (s) => s.replace('stories: 2', 'stories: 2, 3'))
  const r = check()
  expect(failureLines(r.stdout + r.stderr)).toEqual([])
  expect(r.code).toBe(0)
})
