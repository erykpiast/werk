/** Steps 80.x: werk ticket-check. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { project, type Proj } from './lib.ts'

let p: Proj
afterEach(() => p?.cleanup())

type T = { cites: string; blocked?: string; stories: string; touches?: string | null; what?: string }

const ticketText = (n: number, t: T) =>
  [
    `title: Ticket ${n} does a thing`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    `stories: ${t.stories}`,
    ...(t.touches === null ? [] : [`touches: ${t.touches ?? 'map view'}`]),
    '',
    '## What to build',
    '',
    t.what ?? `The person sees ticket ${n} work in the map.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The map shows the change.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

const fileOf = (n: number) => `0${n}-ticket.md`
const ticketPath = (n: number) => join(p.dir, 'tickets', fileOf(n))

function setup(decided: string[], stories: number[], tickets: Record<number, T>) {
  p = project()
  const events: object[] = [{ type: 'node.proposed', payload: { id: 'map', kind: 'card', title: 'The map', status: 'open' } }, { type: 'node.accepted', payload: { id: 'map' }, actor: 'you' }]
  for (const id of decided) {
    events.push({ type: 'node.proposed', payload: { id, kind: 'card', title: `Card ${id}`, status: 'decided', parent: 'map' } })
    events.push({ type: 'node.accepted', payload: { id }, actor: 'you' })
  }
  p.writeLog(events)
  const spec = ['# Spec', '', '## User Stories', '', ...stories.map((n) => `${n}. As a person, I want thing ${n}, so that it helps.`), '', '## Other', ''].join('\n')
  writeFileSync(join(p.dir, 'spec.md'), spec)
  mkdirSync(join(p.dir, 'tickets'))
  for (const [n, t] of Object.entries(tickets)) writeFileSync(ticketPath(Number(n)), ticketText(Number(n), t))
}

const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const failureLines = (out: string) => out.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('ticket-check:'))

test('80.1 a folder of valid tickets passes the ticket check', () => {
  setup(['map-reopen', 'map-stale'], [1, 2, 3], {
    1: { cites: 'map-reopen', stories: '1, 2', touches: 'map view' },
    2: { cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' },
  })
  const r = check()
  expect(failureLines(r.stdout + r.stderr)).toEqual([])
  expect(r.code).toBe(0)
})

test('80.2 a missing touches line and a path in the body fail their own checks by name', () => {
  setup(['map-reopen', 'map-stale'], [1, 2, 3], {
    1: { cites: 'map-reopen', stories: '1', touches: 'map view' },
    2: { cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' },
    3: { cites: 'map-stale', stories: '3', touches: 'fold' },
  })
  expect(check().code).toBe(0)
  const t2 = readFileSync(ticketPath(2), 'utf8').split('\n').filter((l) => !l.startsWith('touches:')).join('\n')
  writeFileSync(ticketPath(2), t2)
  const t3 = readFileSync(ticketPath(3), 'utf8').split('\n')
  const at = t3.indexOf('## What to build') + 2
  t3[at] = `${t3[at]} edit src/loop.ts`
  writeFileSync(ticketPath(3), t3.join('\n'))
  const t1 = readFileSync(ticketPath(1), 'utf8').replace('touches: map view', 'touches: map view, server/routes')
  writeFileSync(ticketPath(1), t1)
  const r = check()
  const lines = failureLines(r.stdout + r.stderr)
  expect(lines.some((l) => l.startsWith(fileOf(2)) && l.includes('shape') && l.includes('touches'))).toBe(true)
  expect(
    lines.some((l) => l.startsWith(fileOf(3)) && l.includes('no-file-paths') && l.includes('src/loop.ts') && l.includes(`line ${at + 1}`)),
  ).toBe(true)
  expect(lines.some((l) => l.startsWith(fileOf(1)) && l.includes(': touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  setup(['map-reopen', 'map-stale'], [1, 2, 3], {
    1: { cites: 'map-reopen', stories: '1' },
    2: { cites: 'map-stale', stories: '3' },
    3: { cites: 'map-reopen', stories: '2' },
    4: { cites: 'map-reopen', blocked: '2', stories: '2' },
  })
  expect(check().code).toBe(0)
  writeFileSync(ticketPath(2), readFileSync(ticketPath(2), 'utf8').replace('## What to build\n', ''))
  const r = check()
  const lines = failureLines(r.stdout + r.stderr)
  expect(lines.some((l) => l.startsWith(fileOf(2)) && l.includes('shape') && l.includes('What to build'))).toBe(true)
  expect(lines.some((l) => l.includes('map-stale') && /cite/.test(l))).toBe(true)
  expect(lines.some((l) => /story 3\b/.test(l) && /deliver/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith(fileOf(4)) && l.includes('blocked_by') && /\b2\b/.test(l))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  setup(['map-reopen', 'map-stale'], [1, 2, 3, 4], {
    1: { cites: 'map-stale', stories: '1, 9' },
    2: { cites: 'map-stale', blocked: '3', stories: '2' },
    3: { cites: 'map-stale', blocked: '2', stories: '3' },
    4: { cites: 'map-stale', stories: '1' },
    5: { cites: 'map-stale', blocked: '8', stories: '2' },
  })
  const r = check()
  const lines = failureLines(r.stdout + r.stderr)
  expect(lines.some((l) => l.includes('map-reopen') && /cite/.test(l))).toBe(true)
  expect(lines.some((l) => /story 4\b/.test(l) && /deliver/.test(l))).toBe(true)
  expect(lines.some((l) => /story 9\b/.test(l) && /spec has no story 9/.test(l))).toBe(true)
  const blocked = lines.filter((l) => l.includes('blocked_by'))
  expect(blocked.some((l) => l.startsWith(fileOf(2)) && /cycle/.test(l))).toBe(true)
  expect(blocked.some((l) => l.startsWith(fileOf(3)) && /cycle/.test(l))).toBe(true)
  expect(blocked.some((l) => l.startsWith(fileOf(5)) && /\b8\b/.test(l))).toBe(true)
  expect(blocked.some((l) => l.startsWith(fileOf(1)) || l.startsWith(fileOf(4)))).toBe(false)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next check passes', () => {
  setup(['map-reopen', 'map-stale'], [1, 2, 3], {
    1: { cites: 'map-reopen', stories: '1' },
    2: { cites: 'map-stale', blocked: '1', stories: '2' },
  })
  const first = check()
  const firstLines = failureLines(first.stdout + first.stderr)
  expect(firstLines).toHaveLength(1)
  expect(firstLines[0]).toMatch(/story 3/)
  writeFileSync(ticketPath(2), readFileSync(ticketPath(2), 'utf8').replace('stories: 2', 'stories: 2, 3'))
  const r = check()
  expect(failureLines(r.stdout + r.stderr)).toEqual([])
  expect(r.code).toBe(0)
})

void unlinkSync
