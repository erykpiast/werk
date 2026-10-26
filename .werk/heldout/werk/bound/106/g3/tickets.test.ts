/** Held-out steps 107.x and 80.x: the ticket-check verb on a folder, a spec and a subtree root. */
import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

type T = { title: string; cites: string; blocked?: string; stories: string; touches?: string; what?: string }

const ticket = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    `stories: ${t.stories}`,
    `touches: ${t.touches ?? 'map view'}`,
    '',
    '## What to build',
    '',
    t.what ?? `A person can do this: ${t.title.toLowerCase()}.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The person sees the result in the map.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

const spec = (n: number) =>
  ['# Spec', '', '## User Stories', '', ...Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}, so that it works.`), ''].join('\n')

/** A project whose map has the root "map" (open) and the decided cards given under it. */
function project(decided: string[]): Project {
  const p = makeProject()
  const log = logOf(proposed('map', { status: 'open' }), accepted('map'), ...decided.flatMap((id) => [proposed(id, { status: 'decided', parent: 'map' }), accepted(id)]))
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  mkdirSync(join(p.dir, 'tickets'))
  return p
}
const put = (p: Project, name: string, text: string) => writeFileSync(join(p.dir, 'tickets', name), text)
const check = (p: Project, specFile = 'spec.md') => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', specFile])
const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr
const failureLines = (r: { stdout: string }) => r.stdout.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check:'))

/** A valid set for the 107 steps: cards a, b decided; stories 1..3; three tickets. */
function valid107(): Project {
  const p = project(['map-a', 'map-b'])
  writeFileSync(join(p.dir, 'spec.md'), spec(3))
  put(p, '01-one.md', ticket({ title: 'Ticket one', cites: 'map-a', stories: '1' }))
  put(p, '02-two.md', ticket({ title: 'Ticket two', cites: 'map-b', stories: '2', touches: 'stale marks' }))
  put(p, '03-three.md', ticket({ title: 'Ticket three', cites: 'map-a', stories: '3', touches: 'fold' }))
  return p
}

test('107.1 a valid ticket set passes the ticket check', () => {
  const p = valid107()
  const r = check(p)
  expect(failureLines(r)).toEqual([])
  expect(r.stdout).toMatch(/0 failure\(s\) in all/)
  expect(r.code).toBe(0)
})

test('107.2 a ticket that fails its shape check makes the run fail', () => {
  const p = valid107()
  const path = join(p.dir, 'tickets', '03-three.md')
  writeFileSync(path, readFileSync(path, 'utf8').replace('## Acceptance criteria\n', ''))
  const r = check(p)
  expect(r.code).toBe(1)
  expect(r.stdout).toMatch(/^03-three\.md: shape: .*Acceptance criteria/m)
  const others = failureLines(r).filter((l) => l.startsWith('01-') || l.startsWith('02-'))
  expect(others).toEqual([])
})

test('107.3 a call with a missing spec cannot run the checks and says so', () => {
  const p = valid107()
  const r = check(p, 'no-such-spec.md')
  expect(r.code).toBe(2)
  expect(out(r)).toContain('no-such-spec.md')
  expect(r.code).not.toBe(0)
  expect(r.code).not.toBe(1)
})

test('107.4 an uncited decided card is reported against the ticket set', () => {
  const p = valid107()
  // The person adds a new decided card under that subtree: the log gains the card, decided and real.
  const log = join(p.dir, '.werk', 'log.jsonl')
  const seq = readFileSync(log, 'utf8').trim().split('\n').length
  const more = logOf(...Array.from({ length: seq }, () => accepted('map')), proposed('map-new', { status: 'decided', parent: 'map' }), accepted('map-new')).slice(seq)
  writeFileSync(log, readFileSync(log, 'utf8') + more.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const r = check(p)
  expect(r.code).toBe(1)
  const lines = failureLines(r).filter((l) => l.includes('map-new'))
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatch(/^ticket set: cards-cited: /)
  expect(lines[0]).not.toMatch(/^\d\d-/)
})

test('107.5 an undelivered story is reported against the ticket set', () => {
  const p = valid107()
  writeFileSync(join(p.dir, 'spec.md'), spec(4))
  const r = check(p)
  expect(r.code).toBe(1)
  const lines = failureLines(r).filter((l) => /\b4\b/.test(l))
  expect(lines).toHaveLength(1)
  expect(lines[0]).toMatch(/^ticket set: stories: .*\b4\b/)
})

/** The 80 steps: decided cards map-reopen and map-stale. */
function base80(): Project {
  const p = project(['map-reopen', 'map-stale'])
  writeFileSync(join(p.dir, 'spec.md'), spec(3))
  return p
}

test('80.1 a folder of valid tickets passes the ticket check', () => {
  const p = base80()
  put(p, '01-reopen.md', ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' }))
  put(p, '02-stale.md', ticket({ title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' }))
  const r = check(p)
  expect(failureLines(r)).toEqual([])
  expect(r.code).toBe(0)
})

function passing80(): Project {
  const p = base80()
  put(p, '01-reopen.md', ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1', touches: 'map view' }))
  put(p, '02-stale.md', ticket({ title: 'Mark stale cards', cites: 'map-stale', stories: '2', touches: 'decision log' }))
  put(p, '03-name.md', ticket({ title: 'Name the cause', cites: 'map-stale', stories: '3', touches: 'stale marks' }))
  return p
}

test('80.2 a ticket with a missing touches line and a path in its body fails its own checks by name', () => {
  const p = passing80()
  expect(check(p).code).toBe(0)
  const edit = (name: string, f: (s: string) => string) => {
    const path = join(p.dir, 'tickets', name)
    writeFileSync(path, f(readFileSync(path, 'utf8')))
  }
  edit('02-stale.md', (s) => s.replace(/^touches:.*\n/m, ''))
  edit('03-name.md', (s) => s.replace('## What to build\n\n', '## What to build\n\nedit src/loop.ts\n'))
  edit('01-reopen.md', (s) => s.replace(/^touches:.*$/m, 'touches: map view, server/routes'))
  const r = check(p)
  const lines = failureLines(r)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: touches'))).toBe(true)
  const lineNo = readFileSync(join(p.dir, 'tickets', '03-name.md'), 'utf8').split('\n').indexOf('edit src/loop.ts') + 1
  expect(lines.some((l) => l.startsWith('03-name.md: no-file-paths:') && l.includes('src/loop.ts') && l.includes(`line ${lineNo}`))).toBe(true)
  expect(lines.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  const p = base80()
  put(p, '01-reopen.md', ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' }))
  put(p, '02-stale.md', ticket({ title: 'Mark stale cards', cites: 'map-stale', stories: '3', touches: 'decision log' }))
  put(p, '04-after.md', ticket({ title: 'After the stale marks', cites: 'map-reopen', blocked: '2', stories: '1', touches: 'fold' }))
  const path = join(p.dir, 'tickets', '02-stale.md')
  writeFileSync(path, readFileSync(path, 'utf8').replace('## What to build\n', ''))
  const r = check(p)
  const lines = failureLines(r)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: What to build'))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: cards-cited:') && l.includes('map-stale'))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: stories:') && /\b3\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('04-after.md: blocked_by:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 a ticket set with coverage and order errors names each card, story and ticket', () => {
  const p = project(['map-reopen', 'map-stale'])
  writeFileSync(join(p.dir, 'spec.md'), spec(4))
  put(p, '01-one.md', ticket({ title: 'One', cites: 'map-stale', stories: '1, 9' }))
  put(p, '02-two.md', ticket({ title: 'Two', cites: 'map-stale', blocked: '3', stories: '2' }))
  put(p, '03-three.md', ticket({ title: 'Three', cites: 'map-stale', blocked: '2', stories: '3' }))
  put(p, '04-four.md', ticket({ title: 'Four', cites: 'map-stale', blocked: '1', stories: '1' }))
  put(p, '05-five.md', ticket({ title: 'Five', cites: 'map-stale', blocked: '8', stories: '2' }))
  const r = check(p)
  const lines = failureLines(r)
  expect(lines.some((l) => l.startsWith('ticket set: cards-cited:') && l.includes('map-reopen'))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && /story 4\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && /\b9\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('02-two.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-three.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('05-five.md: blocked_by:') && /\b8\b/.test(l))).toBe(true)
  expect(lines.filter((l) => /^0[14]-\w+\.md: blocked_by:/.test(l))).toEqual([])
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next ticket check passes', () => {
  const p = base80()
  put(p, '01-reopen.md', ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1', touches: 'map view' }))
  put(p, '02-stale.md', ticket({ title: 'Mark stale cards', cites: 'map-stale', stories: '2', touches: 'decision log' }))
  const before = check(p)
  expect(failureLines(before)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  const path = join(p.dir, 'tickets', '02-stale.md')
  writeFileSync(path, readFileSync(path, 'utf8').replace('stories: 2', 'stories: 2, 3'))
  const r = check(p)
  expect(failureLines(r)).toEqual([])
  expect(r.code).toBe(0)
})
