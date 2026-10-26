import { afterEach, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, out, type Project } from './helpers.ts'
import { check, writeMap, writeSpec, writeTickets } from './tickets.ts'

let p: Project
afterEach(() => p?.cleanup())

const failLines = (s: string) => s.split('\n').filter((l) => /: /.test(l) && !l.startsWith('ticket-check:'))

test('80.1 a folder of valid tickets passes the ticket check', () => {
  p = makeProject()
  writeMap(p, ['map-reopen', 'map-stale'])
  writeSpec(p, 3)
  writeTickets(p, {
    '1-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' },
    '2-stale.md': { title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' },
  })
  const r = check(p)
  expect(failLines(r.stdout)).toEqual([])
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.code).toBe(0)
})

test('80.2 a missing touches line and a path in the body fail their own checks by name', () => {
  p = makeProject()
  writeMap(p, ['map-reopen', 'map-stale'])
  writeSpec(p, 3)
  writeTickets(p, {
    '1-reopen.md': { title: 'Reopen', cites: 'map-reopen', stories: '1', touches: 'map view' },
    '2-stale.md': { title: 'Stale', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' },
    '3-more.md': { title: 'More', cites: 'map-stale', blocked: '2', stories: '3', touches: 'stale marks', what: 'Line one of the work.\nLine two of the work.' },
  })
  expect(check(p).code).toBe(0)
  const f = (n: string) => join(p.dir, 'tickets', n)
  writeFileSync(f('2-stale.md'), readFileSync(f('2-stale.md'), 'utf8').replace(/^touches:.*\n/m, ''))
  const t3 = readFileSync(f('3-more.md'), 'utf8').replace('Line two of the work.', 'Line two of the work.\nedit src/loop.ts')
  writeFileSync(f('3-more.md'), t3)
  const lineNo = t3.split('\n').findIndex((l) => l.includes('src/loop.ts')) + 1
  writeFileSync(f('1-reopen.md'), readFileSync(f('1-reopen.md'), 'utf8').replace(/^touches:.*$/m, 'touches: map view, server/routes'))
  const r = check(p)
  const o = out(r)
  expect(o).toMatch(/^2-stale\.md: shape: touches:/m)
  expect(o).toMatch(new RegExp(`^3-more\\.md: no-file-paths: .*line ${lineNo} .*src/loop\\.ts`, 'm'))
  expect(o).toMatch(/^1-reopen\.md: touches:/m)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  p = makeProject()
  writeMap(p, ['map-reopen', 'map-stale'])
  writeSpec(p, 3)
  writeTickets(p, {
    '1-reopen.md': { title: 'Reopen', cites: 'map-reopen', stories: '1', touches: 'map view' },
    '2-stale.md': { title: 'Stale', cites: 'map-stale', stories: '3', touches: 'decision log', noWhatHeading: true },
    '3-other.md': { title: 'Other', cites: 'map-reopen', stories: '2', touches: 'map view' },
    '4-after.md': { title: 'After', cites: 'map-reopen', blocked: '2', stories: '2', touches: 'map view' },
  })
  const r = check(p)
  const o = out(r)
  expect(o).toMatch(/^2-stale\.md: shape: What to build:/m)
  expect(o).toMatch(/no ticket cites the decided card #map-stale/)
  expect(o).toMatch(/no ticket delivers story 3/)
  expect(o).toMatch(/^4-after\.md: blocked_by: .*2/m)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  p = makeProject()
  writeMap(p, ['map-reopen', 'map-stale'])
  writeSpec(p, 4)
  writeTickets(p, {
    '1-a.md': { title: 'A', cites: 'map-stale', stories: '1, 9', touches: 'map view' },
    '2-b.md': { title: 'B', cites: 'map-stale', blocked: '3', stories: '2', touches: 'map view' },
    '3-c.md': { title: 'C', cites: 'map-stale', blocked: '2', stories: '3', touches: 'map view' },
    '4-d.md': { title: 'D', cites: 'map-stale', stories: '3', touches: 'map view' },
    '5-e.md': { title: 'E', cites: 'map-stale', blocked: '8', stories: '2', touches: 'map view' },
  })
  const r = check(p)
  const o = out(r)
  expect(o).toMatch(/#map-reopen/)
  expect(o).toMatch(/no ticket delivers story 4/)
  expect(o).toMatch(/story 9 is listed, but the spec has no story 9/)
  expect(o).toMatch(/^2-b\.md: blocked_by: .*cycle/m)
  expect(o).toMatch(/^3-c\.md: blocked_by: .*cycle/m)
  expect(o).toMatch(/^5-e\.md: blocked_by: .*8/m)
  expect(o).not.toMatch(/^1-a\.md: blocked_by/m)
  expect(o).not.toMatch(/^4-d\.md: blocked_by/m)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next ticket check passes', () => {
  p = makeProject()
  writeMap(p, ['map-reopen', 'map-stale'])
  writeSpec(p, 3)
  writeTickets(p, {
    '1-reopen.md': { title: 'Reopen', cites: 'map-reopen', stories: '1', touches: 'map view' },
    '2-stale.md': { title: 'Stale', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' },
  })
  const first = check(p)
  expect(first.code).not.toBe(0)
  expect(failLines(first.stdout)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  const f = join(p.dir, 'tickets', '2-stale.md')
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^stories: 2$/m, 'stories: 2, 3'))
  const r = check(p)
  expect(failLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})
