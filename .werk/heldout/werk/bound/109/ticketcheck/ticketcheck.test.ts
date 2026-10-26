/** Held-out steps 107.x and 80.x: the ticket-check verb. */
import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
import type { NewEvent } from '../../src/map/events.ts'

type T = {
  title?: string
  cites?: string
  blocked_by?: string
  stories?: string
  touches?: string | null
  what?: string
  dropHeading?: string
}

function ticket(t: T): string {
  const lines: string[] = [`title: ${t.title ?? 'A ticket'}`, `cites: ${t.cites ?? ''}`, `blocked_by: ${t.blocked_by ?? ''}`, `stories: ${t.stories ?? ''}`]
  if (t.touches !== null) lines.push(`touches: ${t.touches ?? 'map view'}`)
  const sections: [string, string][] = [
    ['What to build', t.what ?? 'A person does a thing and the map shows it.'],
    ['Acceptance criteria', '- [ ] The map shows the thing.'],
    ['Checks', '- `make test`'],
  ]
  for (const [h, body] of sections) {
    lines.push('')
    if (t.dropHeading !== h) lines.push(`## ${h}`, '')
    lines.push(body)
  }
  return lines.join('\n') + '\n'
}

function spec(stories: number[]): string {
  return [
    '# Spec',
    '',
    '## Problem Statement',
    '',
    'A problem.',
    '',
    '## User Stories',
    '',
    ...stories.map((n) => `${n}. As a person, I want thing ${n}, so that it works.`),
    '',
    '## Implementation Decisions',
    '',
    '1. Not a story.',
    '',
  ].join('\n')
}

function project(cards: string[], stories: number[], tickets: Record<string, string>): Project {
  const p = makeProject()
  const events: NewEvent[] = [proposed('map', { status: 'open' }), accepted('map')]
  for (const c of cards) events.push(proposed(c, { status: 'decided', parent: 'map' }), accepted(c))
  writeLog(p, events)
  writeFileSync(join(p.dir, 'spec.md'), spec(stories))
  mkdirSync(join(p.dir, 'tickets'))
  for (const [name, text] of Object.entries(tickets)) writeFileSync(join(p.dir, 'tickets', name), text)
  return p
}

function writeLog(p: Project, events: NewEvent[]) {
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), logOf(...events).map((e) => JSON.stringify(e)).join('\n') + '\n')
}

const check = (p: Project, specFile = 'spec.md') => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', specFile])
const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr
const failureLines = (r: { stdout: string }) =>
  r.stdout
    .trimEnd()
    .split('\n')
    .filter((l) => l !== '' && !l.startsWith('ticket-check:'))

/** A valid set: two decided cards, three stories, two tickets. Ticket 2 is blocked by ticket 1. */
function validSet() {
  return project(['map-reopen', 'map-stale'], [1, 2, 3], {
    '01-reopen.md': ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' }),
    '02-stale.md': ticket({ title: 'Stale marks', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' }),
  })
}

test('107.1 a valid ticket set passes the ticket check', () => {
  const p = validSet()
  const r = check(p)
  expect(r.code).toBe(0)
  expect(failureLines(r)).toEqual([])
  expect(r.stderr).toBe('')
  expect(r.stdout).toContain('0 failure(s)')
})

test('107.2 a ticket that fails its shape check makes the run fail', () => {
  const p = validSet()
  expect(check(p).code).toBe(0)
  writeFileSync(
    join(p.dir, 'tickets', '02-stale.md'),
    ticket({ title: 'Stale marks', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log', dropHeading: 'Acceptance criteria' }),
  )
  const r = check(p)
  expect(r.code).toBe(1)
  expect(r.stdout).toMatch(/^02-stale\.md: shape: Acceptance criteria: .*## Acceptance criteria.*missing/m)
  const ticketLines = failureLines(r).filter((l) => !l.startsWith('ticket set:'))
  for (const l of ticketLines) expect(l.startsWith('02-stale.md:')).toBe(true)
  expect(r.stdout).not.toContain('01-reopen.md')
})

test('107.3 a call with a missing spec cannot run the checks and says so', () => {
  const p = validSet()
  const r = check(p, 'nospec.md')
  expect(r.code).toBe(2)
  expect(out(r)).toContain('nospec.md')
  expect(r.code).not.toBe(0)
  expect(r.code).not.toBe(1)
})

test('107.4 an uncited decided card is reported against the ticket set', () => {
  const p = validSet()
  expect(check(p).code).toBe(0)
  const events: NewEvent[] = [proposed('map', { status: 'open' }), accepted('map')]
  for (const c of ['map-reopen', 'map-stale', 'map-undo']) events.push(proposed(c, { status: 'decided', parent: 'map' }), accepted(c))
  writeLog(p, events)
  const r = check(p)
  expect(r.code).toBe(1)
  const about = out(r).split('\n').filter((l) => l.includes('map-undo'))
  expect(about.length).toBe(1)
  expect(about[0]!).toMatch(/^ticket set: cards-cited: /)
  expect(about[0]!).not.toMatch(/\d\d-[\w-]+\.md/)
})

test('107.5 an undelivered story is reported against the ticket set', () => {
  const p = validSet()
  expect(check(p).code).toBe(0)
  writeFileSync(join(p.dir, 'spec.md'), spec([1, 2, 3, 4]))
  const r = check(p)
  expect(r.code).toBe(1)
  const about = failureLines(r).filter((l) => /\bstory 4\b/.test(l))
  expect(about.length).toBe(1)
  expect(about[0]!).toMatch(/^ticket set: stories: .*\b4\b/)
  expect(about[0]!).not.toMatch(/\d\d-[\w-]+\.md/)
  expect(failureLines(r).length).toBe(1)
})

test('80.1 a folder of valid tickets passes the ticket check', () => {
  const p = project(['map-reopen', 'map-stale'], [1, 2, 3], {
    '01-reopen.md': ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' }),
    '02-stale.md': ticket({ title: 'Stale marks', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' }),
  })
  const r = check(p)
  expect(failureLines(r)).toEqual([])
  expect(r.stderr).toBe('')
  expect(r.code).toBe(0)
})

test('80.2 a missing touches line and a path in the body fail their own checks by name', () => {
  const t1 = { title: 'Reopen', cites: 'map-reopen', stories: '1', touches: 'map view' }
  const t2 = { title: 'Stale', cites: 'map-stale', blocked_by: '1', stories: '2', touches: 'decision log' }
  const t3 = { title: 'Undo', cites: 'map-undo', blocked_by: '1', stories: '3', touches: 'fold' }
  const p = project(['map-reopen', 'map-stale', 'map-undo'], [1, 2, 3], {
    '01-reopen.md': ticket(t1),
    '02-stale.md': ticket(t2),
    '03-undo.md': ticket(t3),
  })
  expect(check(p).code).toBe(0)
  writeFileSync(join(p.dir, 'tickets', '02-stale.md'), ticket({ ...t2, touches: null }))
  const t3text = ticket({ ...t3, what: 'A person does a thing.\nedit src/loop.ts' })
  writeFileSync(join(p.dir, 'tickets', '03-undo.md'), t3text)
  const pathLine = t3text.split('\n').findIndex((l) => l.includes('src/loop.ts')) + 1
  writeFileSync(join(p.dir, 'tickets', '01-reopen.md'), ticket({ ...t1, touches: 'map view, server/routes' }))
  const r = check(p)
  expect(r.stdout).toMatch(/^02-stale\.md: shape: touches: /m)
  expect(r.stdout).toMatch(new RegExp(`^03-undo\\.md: no-file-paths: .*line ${pathLine}\\b.*src/loop\\.ts`, 'm'))
  expect(r.stdout).toMatch(/^01-reopen\.md: touches: /m)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  const t2 = { title: 'Stale', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' }
  const p = project(['map-reopen', 'map-stale'], [1, 2, 3], {
    '01-reopen.md': ticket({ title: 'Reopen', cites: 'map-reopen', stories: '1', touches: 'map view' }),
    '02-stale.md': ticket(t2),
    '03-more.md': ticket({ title: 'More', cites: 'map-reopen', blocked_by: '1', stories: '2', touches: 'fold' }),
    '04-after.md': ticket({ title: 'After', cites: 'map-reopen', blocked_by: '2', stories: '2', touches: 'board' }),
  })
  expect(check(p).code).toBe(0)
  writeFileSync(join(p.dir, 'tickets', '02-stale.md'), ticket({ ...t2, dropHeading: 'What to build' }))
  const r = check(p)
  expect(r.stdout).toMatch(/^02-stale\.md: shape: What to build: .*## What to build.*missing/m)
  expect(r.stdout).toMatch(/^ticket set: cards-cited: .*map-stale/m)
  expect(r.stdout).toMatch(/^ticket set: stories: .*no ticket delivers story 3\b/m)
  expect(r.stdout).toMatch(/^04-after\.md: blocked_by: .*\b2\b.*not a ticket in the set/m)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  const p = project(['map-reopen', 'map-stale'], [1, 2, 3, 4], {
    '01-one.md': ticket({ title: 'One', cites: 'map-stale', stories: '1, 9', touches: 'map view' }),
    '02-two.md': ticket({ title: 'Two', cites: 'map-stale', blocked_by: '3', stories: '2', touches: 'fold' }),
    '03-three.md': ticket({ title: 'Three', cites: 'map-stale', blocked_by: '2', stories: '3', touches: 'board' }),
    '04-four.md': ticket({ title: 'Four', cites: 'map-stale', blocked_by: '1', stories: '2', touches: 'chat' }),
    '05-five.md': ticket({ title: 'Five', cites: 'map-stale', blocked_by: '8', stories: '3', touches: 'plan' }),
  })
  const r = check(p)
  expect(r.stdout).toMatch(/^ticket set: cards-cited: .*map-reopen/m)
  expect(r.stdout).toMatch(/^ticket set: stories: .*no ticket delivers story 4\b/m)
  expect(r.stdout).toMatch(/^ticket set: stories: .*story 9\b.*spec has no story 9/m)
  expect(r.stdout).toMatch(/^02-two\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^03-three\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^05-five\.md: blocked_by: .*\b8\b.*not a ticket in the set/m)
  expect(r.stdout).not.toMatch(/^01-one\.md: blocked_by:/m)
  expect(r.stdout).not.toMatch(/^04-four\.md: blocked_by:/m)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next ticket check passes', () => {
  const p = project(['map-reopen', 'map-stale'], [1, 2, 3], {
    '01-reopen.md': ticket({ title: 'Reopen', cites: 'map-reopen', stories: '1', touches: 'map view' }),
    '02-stale.md': ticket({ title: 'Stale', cites: 'map-stale', blocked_by: '1', stories: '2', touches: 'decision log' }),
  })
  const before = check(p)
  expect(before.code).toBe(1)
  expect(failureLines(before)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  const file = join(p.dir, 'tickets', '02-stale.md')
  writeFileSync(file, readFileSync(file, 'utf8').replace('stories: 2', 'stories: 2, 3'))
  const r = check(p)
  expect(failureLines(r)).toEqual([])
  expect(r.code).toBe(0)
})
