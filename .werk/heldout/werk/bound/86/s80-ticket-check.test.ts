/** Held-out steps 80.1 - 80.5: the ticket check verb on a folder of tickets. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

function project(cards: string[] = ['map-reopen', 'map-stale']): Project {
  p = makeProject()
  const log = logOf(
    proposed('map', { status: 'open' }),
    ...cards.flatMap((c) => [proposed(c, { status: 'decided', parent: 'map' }), accepted(c)]),
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  mkdirSync(join(p.dir, 'tickets'))
  return p
}

const spec = (n: number) =>
  `# Spec\n\n## Problem Statement\n\nA problem.\n\n## User Stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}, so that it works.`).join('\n')}\n\n## Implementation Decisions\n\n1. Not a story.\n`

type T = { title?: string; cites: string; blocked?: string; stories: string; touches?: string | null; what?: string; noWhat?: boolean }
const ticket = (t: T) =>
  [
    `title: ${t.title ?? 'A ticket'}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    `stories: ${t.stories}`,
    ...(t.touches === null ? [] : [`touches: ${t.touches ?? 'map view'}`]),
    '',
    ...(t.noWhat ? [] : ['## What to build', '']),
    t.what ?? 'A person does a thing and sees the result.',
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

const write = (name: string, text: string) => writeFileSync(join(p.dir, 'tickets', name), text)
const writeSpec = (n: number) => writeFileSync(join(p.dir, 'spec.md'), spec(n))
const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const failureLines = (out: string) => out.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check:'))

test('80.1 a folder of valid tickets passes the ticket check', () => {
  project()
  writeSpec(3)
  write('01-reopen.md', ticket({ cites: 'map-reopen', stories: '1, 2', touches: 'map view' }))
  write('02-stale.md', ticket({ cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' }))
  const r = check()
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.code).toBe(0)
})

function passingSet() {
  project()
  writeSpec(3)
  write('01-reopen.md', ticket({ cites: 'map-reopen', stories: '1', touches: 'map view' }))
  write('02-stale.md', ticket({ cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' }))
  write('03-more.md', ticket({ cites: 'map-stale', blocked: '2', stories: '3', touches: 'stale marks' }))
}

test('80.2 a missing touches line and a path in the body fail their own checks by name', () => {
  passingSet()
  expect(check().code).toBe(0)
  write('02-stale.md', ticket({ cites: 'map-stale', blocked: '1', stories: '2', touches: null }))
  write('03-more.md', ticket({ cites: 'map-stale', blocked: '2', stories: '3', touches: 'stale marks', what: 'A person does a thing.\nedit src/loop.ts' }))
  write('01-reopen.md', ticket({ cites: 'map-reopen', stories: '1', touches: 'map view, server/routes' }))
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: touches:'))).toBe(true)
  const t3 = lines.find((l) => l.startsWith('03-more.md: no-file-paths:'))
  expect(t3).toBeDefined()
  expect(t3).toContain('src/loop.ts')
  expect(t3).toMatch(/line \d+/)
  // The path is on line 10 of the file.
  expect(t3).toContain('line 10')
  expect(lines.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  project(['map-reopen', 'map-stale'])
  writeSpec(3)
  write('01-reopen.md', ticket({ cites: 'map-reopen', stories: '1' }))
  write('02-stale.md', ticket({ cites: 'map-stale', blocked: '1', stories: '3' }))
  write('03-other.md', ticket({ cites: 'map-reopen', stories: '2' }))
  write('04-after.md', ticket({ cites: 'map-reopen', blocked: '2', stories: '2' }))
  expect(check().code).toBe(0)
  write('02-stale.md', ticket({ cites: 'map-stale', blocked: '1', stories: '3', noWhat: true }))
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: What to build:'))).toBe(true)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('#map-stale'))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && l.includes('story 3'))).toBe(true)
  expect(lines.some((l) => l.startsWith('04-after.md: blocked_by:') && l.includes('blocker 2'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 a ticket set with coverage and order errors names each card, story and ticket', () => {
  project(['map-reopen', 'map-stale'])
  writeSpec(4)
  write('01-a.md', ticket({ cites: 'map-stale', stories: '1, 9' }))
  write('02-b.md', ticket({ cites: 'map-stale', blocked: '3', stories: '2' }))
  write('03-c.md', ticket({ cites: 'map-stale', blocked: '2', stories: '3' }))
  write('04-d.md', ticket({ cites: 'map-stale', blocked: '1', stories: '3' }))
  write('05-e.md', ticket({ cites: 'map-stale', blocked: '8', stories: '2' }))
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('#map-reopen'))).toBe(true)
  expect(lines.some((l) => l.includes('no ticket delivers story 4'))).toBe(true)
  expect(lines.some((l) => l.includes('story 9') && l.includes('spec has no story 9'))).toBe(true)
  expect(lines.some((l) => l.startsWith('02-b.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-c.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('05-e.md: blocked_by:') && l.includes('8'))).toBe(true)
  const blocked = lines.filter((l) => l.includes(': blocked_by:'))
  expect(blocked.some((l) => l.startsWith('01-a.md'))).toBe(false)
  expect(blocked.some((l) => l.startsWith('04-d.md'))).toBe(false)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next ticket check passes', () => {
  project()
  writeSpec(3)
  write('01-reopen.md', ticket({ cites: 'map-reopen', stories: '1' }))
  write('02-stale.md', ticket({ cites: 'map-stale', blocked: '1', stories: '2' }))
  const before = check()
  expect(failureLines(before.stdout)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  expect(before.code).not.toBe(0)
  // The agent's edit: ticket 2 lists story 3.
  const path = join(p.dir, 'tickets', '02-stale.md')
  writeFileSync(path, readFileSync(path, 'utf8').replace('stories: 2', 'stories: 2, 3'))
  const r = check()
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})
