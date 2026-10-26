/** Held-out steps 80.x and 107.x: the ticket-check verb. */
import { expect, test } from 'bun:test'
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

type T = { n: number; slug: string; title: string; cites: string; blockedBy: string; stories: string; touches: string; what?: string }

function ticketText(t: T): string {
  return [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blockedBy}`,
    `stories: ${t.stories}`,
    `touches: ${t.touches}`,
    '',
    '## What to build',
    '',
    t.what ?? `Build the behaviour of ${t.title.toLowerCase()}.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The person sees the change in the map.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
}

const fileOf = (t: T) => `${String(t.n).padStart(2, '0')}-${t.slug}.md`

function spec(numbers: number[]): string {
  return ['# Spec', '', '## User Stories', '', ...numbers.map((n) => `${n}. As a person, I want thing ${n}, so that it works.`), '', '## Notes', ''].join('\n')
}

function project(decided: string[], tickets: T[], stories: number[]): Project {
  const p = makeProject()
  const log = logOf(
    proposed('map', { status: 'open' }),
    ...decided.map((id) => proposed(id, { status: 'decided', parent: 'map' })),
    proposed('map-later', { status: 'open', parent: 'map' }),
    accepted('map'),
    ...decided.map((id) => accepted(id)),
    accepted('map-later'),
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  mkdirSync(join(p.dir, 'tickets'))
  for (const t of tickets) writeFileSync(join(p.dir, 'tickets', fileOf(t)), ticketText(t))
  writeFileSync(join(p.dir, 'spec.md'), spec(stories))
  return p
}

const run = (p: Project, specFile = 'spec.md') => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', specFile])
const failLines = (out: string) => out.split('\n').filter((l) => l && !l.startsWith('ticket-check:'))
const edit = (p: Project, t: T, fn: (s: string) => string) => {
  const path = join(p.dir, 'tickets', fileOf(t))
  writeFileSync(path, fn(readFileSync(path, 'utf8')))
}

// ---------- 80 ----------

const t80_1: T = { n: 1, slug: 'reopen', title: 'A person reopens a card', cites: 'map-reopen', blockedBy: '', stories: '1, 2', touches: 'map view' }
const t80_2: T = { n: 2, slug: 'stale', title: 'Dependent cards show stale', cites: 'map-stale', blockedBy: '1', stories: '3', touches: 'decision log' }

test('80.1 a folder of valid tickets passes the ticket check', () => {
  const p = project(['map-reopen', 'map-stale'], [t80_1, t80_2], [1, 2, 3])
  const r = run(p)
  expect(failLines(r.stdout)).toEqual([])
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.code).toBe(0)
})

const t3: T = { n: 3, slug: 'loop', title: 'The loop picks the next card', cites: 'map-loop', blockedBy: '', stories: '4', touches: 'loop' }

test('80.2 missing touches line and a path in the body fail their own checks by name', () => {
  const p = project(['map-reopen', 'map-stale', 'map-loop'], [t80_1, t80_2, t3], [1, 2, 3, 4])
  expect(run(p).code).toBe(0)
  edit(p, t80_2, (s) => s.replace(/^touches:.*\n/m, ''))
  edit(p, t3, (s) => s.replace('## What to build\n\n', '## What to build\n\nedit src/loop.ts\n'))
  edit(p, t80_1, (s) => s.replace(/^touches:.*$/m, 'touches: map view, server/routes'))
  const r = run(p)
  const lines = failLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: touches'))).toBe(true)
  const pathLine = lines.find((l) => l.startsWith('03-loop.md: no-file-paths'))
  expect(pathLine).toBeDefined()
  expect(pathLine!).toContain('src/loop.ts')
  const lineNo = readFileSync(join(p.dir, 'tickets', '03-loop.md'), 'utf8').split('\n').indexOf('edit src/loop.ts') + 1
  expect(pathLine!).toContain(`line ${lineNo}`)
  expect(lines.some((l) => l.startsWith('01-reopen.md: touches'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  const tickets: T[] = [
    { n: 1, slug: 'reopen', title: 'A person reopens a card', cites: 'map-reopen', blockedBy: '', stories: '1, 2', touches: 'map view' },
    { n: 2, slug: 'stale', title: 'Dependent cards show stale', cites: 'map-stale', blockedBy: '1', stories: '3', touches: 'decision log' },
    { n: 4, slug: 'after', title: 'Follow-up after stale', cites: 'map-reopen', blockedBy: '2', stories: '1', touches: 'stale marks' },
  ]
  const p = project(['map-reopen', 'map-stale'], tickets, [1, 2, 3])
  expect(run(p).code).toBe(0)
  edit(p, tickets[1]!, (s) => s.replace('## What to build\n', ''))
  const r = run(p)
  const lines = failLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: What to build') && l.includes('missing'))).toBe(true)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('#map-stale'))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && /story 3\b/.test(l) && l.startsWith('ticket set'))).toBe(true)
  expect(lines.some((l) => l.startsWith('04-after.md: blocked_by'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  const tickets: T[] = [
    { n: 1, slug: 'one', title: 'One', cites: 'map-stale', blockedBy: '', stories: '1, 9', touches: 'map view' },
    { n: 2, slug: 'two', title: 'Two', cites: 'map-stale', blockedBy: '3', stories: '2', touches: 'decision log' },
    { n: 3, slug: 'three', title: 'Three', cites: 'map-stale', blockedBy: '2', stories: '3', touches: 'fold' },
    { n: 4, slug: 'four', title: 'Four', cites: 'map-stale', blockedBy: '1', stories: '1', touches: 'stale marks' },
    { n: 5, slug: 'five', title: 'Five', cites: 'map-stale', blockedBy: '8', stories: '2', touches: 'board' },
  ]
  const p = project(['map-reopen', 'map-stale'], tickets, [1, 2, 3, 4])
  const r = run(p)
  const lines = failLines(r.stdout)
  expect(lines.some((l) => l.includes('#map-reopen') && l.includes('cards-cited'))).toBe(true)
  expect(lines.some((l) => /no ticket delivers story 4\b/.test(l))).toBe(true)
  expect(lines.some((l) => /story 9\b/.test(l))).toBe(true)
  const blocked = lines.filter((l) => l.includes(': blocked_by: '))
  expect(blocked.some((l) => l.startsWith('02-two.md') && l.includes('cycle'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('03-three.md') && l.includes('cycle'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('05-five.md') && l.includes('8'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('01-one.md') || l.startsWith('04-four.md'))).toBe(false)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next ticket check passes', () => {
  const tickets: T[] = [
    { n: 1, slug: 'reopen', title: 'A person reopens a card', cites: 'map-reopen', blockedBy: '', stories: '1, 2', touches: 'map view' },
    { n: 2, slug: 'stale', title: 'Dependent cards show stale', cites: 'map-stale', blockedBy: '1', stories: '2', touches: 'decision log' },
  ]
  const p = project(['map-reopen', 'map-stale'], tickets, [1, 2, 3])
  const first = run(p)
  expect(failLines(first.stdout)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  edit(p, tickets[1]!, (s) => s.replace(/^stories:.*$/m, 'stories: 2, 3'))
  const r = run(p)
  expect(failLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})

// ---------- 107 ----------

const valid: T[] = [
  { n: 1, slug: 'reopen', title: 'A person reopens a card', cites: 'map-reopen', blockedBy: '', stories: '1', touches: 'map view' },
  { n: 2, slug: 'stale', title: 'Dependent cards show stale', cites: 'map-stale', blockedBy: '1', stories: '2, 3', touches: 'decision log' },
]
const validProject = () => project(['map-reopen', 'map-stale'], valid, [1, 2, 3])

test('107.1 a valid ticket set passes the ticket check', () => {
  const p = validProject()
  const r = run(p)
  expect(r.code).toBe(0)
  expect(failLines(r.stdout)).toEqual([])
  expect(r.stdout).toContain('0 failure(s)')
})

test('107.2 a ticket that fails its shape check makes the run fail', () => {
  const p = validProject()
  edit(p, valid[1]!, (s) => s.replace('## Acceptance criteria\n', ''))
  const r = run(p)
  expect(r.code).toBe(1)
  const lines = failLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: Acceptance criteria') && l.includes('## Acceptance criteria'))).toBe(true)
  expect(lines.filter((l) => !l.startsWith('02-stale.md') && !l.startsWith('ticket set'))).toEqual([])
})

test('107.3 a call with a missing spec cannot run the checks and says so', () => {
  const p = validProject()
  const r = run(p, 'no-such-spec.md')
  expect(r.code).toBe(2)
  expect(r.stderr + r.stdout).toContain('no-such-spec.md')
  expect(r.code).not.toBe(0)
  expect(r.code).not.toBe(1)
})

test('107.4 an uncited decided card is reported against the ticket set', () => {
  const p = validProject()
  expect(run(p).code).toBe(0)
  const extra = logOf(...Array.from({ length: 8 }, () => ({ type: 'note.said', payload: { id: 'map', text: 'x' } }) as never), proposed('map-new', { status: 'decided', parent: 'map' }), accepted('map-new')).slice(8)
  // append with sequence numbers after the existing log
  const existing = readFileSync(join(p.dir, '.werk', 'log.jsonl'), 'utf8').split('\n').filter(Boolean)
  const nextSeq = existing.length + 1
  for (const [i, e] of extra.entries()) appendFileSync(join(p.dir, '.werk', 'log.jsonl'), JSON.stringify({ ...e, seq: nextSeq + i }) + '\n')
  expect(p.werk(['show', 'map-new']).stdout).toContain('decided')
  const r = run(p)
  expect(r.code).toBe(1)
  const about = failLines(r.stdout).filter((l) => l.includes('map-new'))
  expect(about).toHaveLength(1)
  expect(about[0]!.startsWith('ticket set: cards-cited:')).toBe(true)
  expect(about[0]!).toContain('#map-new')
  expect(/^\d\d-[\w-]+\.md/.test(about[0]!)).toBe(false)
})

test('107.5 an undelivered story is reported against the ticket set', () => {
  const p = validProject()
  expect(run(p).code).toBe(0)
  writeFileSync(join(p.dir, 'spec.md'), spec([1, 2, 3, 4]))
  const r = run(p)
  expect(r.code).toBe(1)
  const about = failLines(r.stdout).filter((l) => /story 4\b/.test(l))
  expect(about).toHaveLength(1)
  expect(about[0]!.startsWith('ticket set: stories:')).toBe(true)
  expect(/\.md/.test(about[0]!)).toBe(false)
})
