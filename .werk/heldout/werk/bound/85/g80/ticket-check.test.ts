/** Held-out steps 80.1–80.5: the ticket check on a folder of ticket files. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

type T = { title: string; cites: string; blocked?: string; stories: string; touches?: string | null; what?: string; noWhat?: boolean }
const ticketText = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    `stories: ${t.stories}`,
    ...(t.touches === null ? [] : [`touches: ${t.touches ?? 'map view'}`]),
    '',
    ...(t.noWhat ? [] : ['## What to build', '', t.what ?? 'A person sees the change in the map.', '']),
    '## Acceptance criteria',
    '',
    '- [ ] The map shows the change.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

function project(decided: string[], storyCount: number): Project {
  p = makeProject()
  const events = [proposed('map', { status: 'open' }), accepted('map')]
  for (const id of decided) events.push(proposed(id, { status: 'decided', parent: 'map' }), accepted(id))
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), logOf(...events).map((e) => JSON.stringify(e)).join('\n') + '\n')
  const stories = Array.from({ length: storyCount }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}, so that it works.`)
  writeFileSync(join(p.dir, 'spec.md'), ['# Spec', '', '## User Stories', '', ...stories, ''].join('\n'))
  mkdirSync(join(p.dir, 'tickets'))
  return p
}
const write = (name: string, t: T) => writeFileSync(join(p.dir, 'tickets', name), ticketText(t))
const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const failLines = (out: string) => out.trimEnd().split('\n').filter((l) => !l.startsWith('ticket-check:'))

test('80.1 a folder of valid tickets passes the ticket check', () => {
  project(['map-reopen', 'map-stale'], 3)
  write('01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' })
  write('02-stale.md', { title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' })
  const r = check()
  expect(failLines(r.stdout)).toEqual([])
  expect(r.stdout).toContain('0 failure(s) in all')
  expect(r.code).toBe(0)
})

function passingSet() {
  project(['map-reopen', 'map-stale'], 3)
  write('01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', stories: '1' })
  write('02-stale.md', { title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '2' })
  write('03-name.md', { title: 'Name the cause', cites: 'map-stale', blocked: '2', stories: '3' })
  expect(check().code).toBe(0)
}

test('80.2 a missing touches line and a path in the body fail their own checks by name', () => {
  passingSet()
  write('02-stale.md', { title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '2', touches: null })
  write('03-name.md', { title: 'Name the cause', cites: 'map-stale', blocked: '2', stories: '3', what: 'A person sees the cause.\nedit src/loop.ts' })
  write('01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', stories: '1', touches: 'map view, server/routes' })
  const r = check()
  const lines = failLines(r.stdout)
  expect(lines.some((l) => /^02-stale\.md: shape: touches:/.test(l))).toBe(true)
  // "edit src/loop.ts" is on line 10 of ticket 3.
  expect(lines.some((l) => l.startsWith('03-name.md: no-file-paths:') && l.includes('"src/loop.ts"') && /line \d+/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  project(['map-reopen', 'map-stale'], 3)
  write('01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2' })
  write('02-stale.md', { title: 'Mark stale cards', cites: 'map-stale', stories: '3', noWhat: true })
  write('04-after.md', { title: 'After stale', cites: 'map-reopen', blocked: '2', stories: '1' })
  const r = check()
  const lines = failLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: What to build:'))).toBe(true)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('map-stale'))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && l.includes('story 3'))).toBe(true)
  expect(lines.some((l) => l.startsWith('04-after.md: blocked_by:') && l.includes('2'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  project(['map-reopen', 'map-stale'], 4)
  write('01-one.md', { title: 'One', cites: 'map-stale', stories: '1, 9' })
  write('02-two.md', { title: 'Two', cites: 'map-stale', blocked: '3', stories: '2' })
  write('03-three.md', { title: 'Three', cites: 'map-stale', blocked: '2', stories: '3' })
  write('04-four.md', { title: 'Four', cites: 'map-stale', blocked: '1', stories: '3' })
  write('05-five.md', { title: 'Five', cites: 'map-stale', blocked: '8', stories: '1' })
  const r = check()
  const lines = failLines(r.stdout)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('#map-reopen'))).toBe(true)
  expect(lines.some((l) => l.includes('no ticket delivers story 4'))).toBe(true)
  expect(lines.some((l) => l.includes('story 9') && l.includes('no story 9'))).toBe(true)
  const blocked = lines.filter((l) => / blocked_by: /.test(l))
  expect(blocked.some((l) => l.startsWith('02-two.md') && l.includes('cycle'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('03-three.md') && l.includes('cycle'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('05-five.md') && l.includes('8'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('01-one.md') || l.startsWith('04-four.md'))).toBe(false)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next ticket check passes', () => {
  project(['map-reopen', 'map-stale'], 3)
  write('01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', stories: '1' })
  write('02-stale.md', { title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '2' })
  const before = check()
  expect(failLines(before.stdout)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  // The agent edits the stories line of ticket 2, the way a person asks it to.
  const file = join(p.dir, 'tickets', '02-stale.md')
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^stories: 2$/m, 'stories: 2, 3'))
  const r = check()
  expect(failLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})
void rmSync
