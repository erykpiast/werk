/** Held-out steps 107.x and 80.x: the ticket-check verb. */
import { expect, test } from 'bun:test'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

type T = { title?: string; cites?: string; blocked_by?: string; stories?: string; touches?: string; what?: string; omit?: string[] }

function ticketText(t: T): string {
  const omit = new Set(t.omit ?? [])
  const lines: string[] = []
  const header: [string, string][] = [
    ['title', t.title ?? 'A person does a thing'],
    ['cites', t.cites ?? ''],
    ['blocked_by', t.blocked_by ?? ''],
    ['stories', t.stories ?? ''],
    ['touches', t.touches ?? 'map view'],
  ]
  for (const [k, v] of header) if (!omit.has(k)) lines.push(`${k}: ${v}`)
  lines.push('')
  if (!omit.has('What to build')) lines.push('## What to build', '', t.what ?? 'The person sees the thing work.', '')
  if (!omit.has('Acceptance criteria')) lines.push('## Acceptance criteria', '', '- [ ] The thing works.', '')
  if (!omit.has('Checks')) lines.push('## Checks', '', '- `make test`', '')
  return lines.join('\n')
}

const spec = (stories: number[]) =>
  ['# Spec', '', '## Problem Statement', '', 'A problem.', '', '## User Stories', '', ...stories.map((n) => `${n}. As a person, I want story ${n}.`), '', '## Implementation Decisions', '', '1. Not a story.', ''].join('\n')

/** A project with root "map" (open) and decided children. */
function project(decided: string[], rootDecided = false): Project {
  const p = makeProject()
  const events = [
    proposed('map', { status: rootDecided ? 'decided' : 'open' }),
    ...decided.flatMap((id) => [proposed(id, { status: 'decided', parent: 'map' }), accepted(id)]),
  ]
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), logOf(...events).map((e) => JSON.stringify(e)).join('\n') + '\n')
  mkdirSync(join(p.dir, 'tickets'))
  return p
}

const writeTicket = (p: Project, name: string, t: T) => writeFileSync(join(p.dir, 'tickets', name), ticketText(t))
const writeSpec = (p: Project, stories: number[]) => writeFileSync(join(p.dir, 'spec.md'), spec(stories))
const check = (p: Project, specFile = 'spec.md') => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', specFile])
const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr
const failureLines = (r: { stdout: string }) => r.stdout.split('\n').filter((l) => l && !l.startsWith('ticket-check:'))

/** A valid set: decided cards a, b; stories 1, 2; two tickets. */
function validSet(): Project {
  const p = project(['map-a', 'map-b'])
  writeSpec(p, [1, 2])
  writeTicket(p, '01-a.md', { title: 'Ticket one', cites: 'map-a', stories: '1', touches: 'map view' })
  writeTicket(p, '02-b.md', { title: 'Ticket two', cites: 'map-b', blocked_by: '1', stories: '2', touches: 'decision log' })
  return p
}

test('107.1 a valid ticket set passes the ticket check', () => {
  const p = validSet()
  const r = check(p)
  expect(r.code).toBe(0)
  expect(failureLines(r)).toEqual([])
  expect(r.stdout).toContain('0 failure(s)')
})

test('107.2 a ticket that fails its shape check makes the run fail', () => {
  const p = validSet()
  writeTicket(p, '03-c.md', { title: 'Ticket three', cites: 'map-a', stories: '1', omit: ['Acceptance criteria'] })
  const r = check(p)
  expect(r.code).toBe(1)
  const lines = failureLines(r)
  const shapeLine = lines.find((l) => l.startsWith('03-c.md: shape:') && l.includes('## Acceptance criteria'))
  expect(shapeLine).toBeDefined()
  expect(lines.filter((l) => /^0[12]-/.test(l))).toEqual([])
})

test('107.3 a call with a missing spec exits 2 and names the spec', () => {
  const p = validSet()
  const r = check(p, 'no-such-spec.md')
  expect(r.code).toBe(2)
  expect(out(r)).toContain('no-such-spec.md')
  expect([0, 1]).not.toContain(r.code)
})

test('107.4 an uncited decided card is reported against the ticket set', () => {
  const p = validSet()
  const log = join(p.dir, '.werk', 'log.jsonl')
  const n = readFileSync(log, 'utf8').trim().split('\n').length
  const more = logOf(...Array.from({ length: n }, () => accepted('x')), proposed('map-new', { status: 'decided', parent: 'map' }), accepted('map-new')).slice(n)
  appendFileSync(log, more.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const r = check(p)
  expect(r.code).toBe(1)
  const about = failureLines(r).filter((l) => l.includes('map-new'))
  expect(about).toHaveLength(1)
  expect(about[0]!).toMatch(/^ticket set: cards-cited: /)
  expect(about[0]!).not.toMatch(/^\d\d-/)
})

test('107.5 an undelivered story is reported against the ticket set', () => {
  const p = validSet()
  writeSpec(p, [1, 2, 3])
  const r = check(p)
  expect(r.code).toBe(1)
  const about = failureLines(r).filter((l) => /story 3\b/.test(l))
  expect(about).toHaveLength(1)
  expect(about[0]!).toMatch(/^ticket set: stories: /)
  expect(about[0]!).not.toMatch(/^\d\d-/)
})

/** 80: decided cards map-reopen and map-stale, stories 1, 2, 3. */
function set80(): Project {
  const p = project(['map-reopen', 'map-stale'])
  writeSpec(p, [1, 2, 3])
  writeTicket(p, '01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' })
  writeTicket(p, '02-stale.md', { title: 'Show stale marks', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' })
  return p
}

test('80.1 a folder of valid tickets passes the ticket check', () => {
  const p = set80()
  const r = check(p)
  expect(failureLines(r)).toEqual([])
  expect(r.code).toBe(0)
})

test('80.2 a missing touches line and a path in the body fail their own checks by name', () => {
  const p = set80()
  writeTicket(p, '03-third.md', { title: 'Third', cites: 'map-reopen', stories: '1', touches: 'fold' })
  expect(check(p).code).toBe(0)
  writeTicket(p, '02-stale.md', { title: 'Show stale marks', cites: 'map-stale', blocked_by: '1', stories: '3', omit: ['touches'] })
  writeTicket(p, '03-third.md', { title: 'Third', cites: 'map-reopen', stories: '1', touches: 'fold', what: 'The person sees the thing work.\nedit src/loop.ts' })
  writeTicket(p, '01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view, server/routes' })
  const r = check(p)
  const lines = failureLines(r)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: touches'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-third.md: no-file-paths:') && l.includes('"src/loop.ts"') && /line \d+/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  const p = set80()
  writeTicket(p, '04-after.md', { title: 'After', cites: 'map-reopen', blocked_by: '2', stories: '1', touches: 'fold' })
  expect(check(p).code).toBe(0)
  writeTicket(p, '02-stale.md', { title: 'Show stale marks', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log', omit: ['What to build'] })
  const r = check(p)
  const lines = failureLines(r)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape:') && l.includes('What to build'))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: cards-cited:') && l.includes('map-stale'))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: stories:') && /story 3\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('04-after.md: blocked_by:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  const p = project(['map-reopen', 'map-stale'])
  writeSpec(p, [1, 2, 3, 4])
  writeTicket(p, '01-one.md', { title: 'One', cites: 'map-stale', stories: '1, 9', touches: 'a' })
  writeTicket(p, '02-two.md', { title: 'Two', blocked_by: '3', stories: '2', touches: 'b' })
  writeTicket(p, '03-three.md', { title: 'Three', blocked_by: '2', stories: '3', touches: 'c' })
  writeTicket(p, '04-four.md', { title: 'Four', blocked_by: '1', touches: 'd' })
  writeTicket(p, '05-five.md', { title: 'Five', blocked_by: '8', touches: 'e' })
  const r = check(p)
  const lines = failureLines(r)
  expect(lines.some((l) => l.startsWith('ticket set: cards-cited:') && l.includes('map-reopen'))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: stories:') && /no ticket delivers story 4\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: stories:') && /story 9\b/.test(l))).toBe(true)
  const blocked = lines.filter((l) => l.includes(': blocked_by:'))
  expect(blocked.some((l) => l.startsWith('02-two.md:') && l.includes('cycle'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('03-three.md:') && l.includes('cycle'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('05-five.md:') && l.includes('8'))).toBe(true)
  expect(blocked.filter((l) => l.startsWith('01-one.md:') || l.startsWith('04-four.md:'))).toEqual([])
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next check passes', () => {
  const p = project(['map-reopen', 'map-stale'])
  writeSpec(p, [1, 2, 3])
  writeTicket(p, '01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' })
  writeTicket(p, '02-stale.md', { title: 'Show stale marks', cites: 'map-stale', blocked_by: '1', stories: '', touches: 'decision log' })
  const before = check(p)
  expect(failureLines(before)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  // The agent's edit: ticket 2 lists story 3.
  const path = join(p.dir, 'tickets', '02-stale.md')
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^stories:.*$/m, 'stories: 3'))
  expect(existsSync(path)).toBe(true)
  const r = check(p)
  expect(failureLines(r)).toEqual([])
  expect(r.code).toBe(0)
})
