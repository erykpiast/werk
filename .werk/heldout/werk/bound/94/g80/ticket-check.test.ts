import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

type T = { n: number; cites: string; blocked?: string; stories: string; touches?: string | null; what?: string | null }
const ticket = (t: T) =>
  [
    `title: Ticket number ${t.n} does a thing`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    `stories: ${t.stories}`,
    ...(t.touches === null ? [] : [`touches: ${t.touches ?? 'map view'}`]),
    '',
    ...(t.what === null ? [] : ['## What to build', '', t.what ?? 'A person does the thing and sees it.', '']),
    '## Acceptance criteria',
    '',
    '- [ ] The thing shows.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

function project(stories: number): Project {
  p = makeProject()
  const log = logOf(
    proposed('map', { status: 'open' }),
    proposed('map-reopen', { status: 'decided', parent: 'map' }),
    proposed('map-stale', { status: 'decided', parent: 'map' }),
    accepted('map-reopen'),
    accepted('map-stale'),
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  const lines = ['# Spec', '', '## Problem Statement', '', 'x', '', '## User Stories', '']
  for (let i = 1; i <= stories; i++) lines.push(`${i}. As a person, I want thing ${i}, so that it works.`)
  lines.push('', '## Implementation Decisions', '', '1. Not a story.', '')
  writeFileSync(join(p.dir, 'spec.md'), lines.join('\n'))
  mkdirSync(join(p.dir, 'tickets'))
  return p
}
const put = (t: T) => writeFileSync(join(p.dir, 'tickets', `0${t.n}-t.md`), ticket(t))
const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const failLines = (out: string) => out.split('\n').filter((l) => l && !l.startsWith('ticket-check:'))

test('80.1 a folder of valid tickets passes', () => {
  project(3)
  put({ n: 1, cites: 'map-reopen', stories: '1, 2', touches: 'map view' })
  put({ n: 2, cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' })
  const r = check()
  console.log(r.stdout, r.stderr)
  expect(failLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})

test('80.2 missing touches, a path in body, a path-like touches', () => {
  project(3)
  put({ n: 1, cites: 'map-reopen', stories: '1', touches: 'map view' })
  put({ n: 2, cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' })
  put({ n: 3, cites: 'map-reopen', stories: '3', touches: 'stale marks' })
  expect(check().code).toBe(0)
  put({ n: 2, cites: 'map-stale', blocked: '1', stories: '2', touches: null })
  put({ n: 3, cites: 'map-reopen', stories: '3', touches: 'stale marks', what: 'A person does the thing and sees it.\nedit src/loop.ts' })
  put({ n: 1, cites: 'map-reopen', stories: '1', touches: 'map view, server/routes' })
  const r = check()
  console.log(r.stdout)
  const text = readFileSync(join(p.dir, 'tickets', '03-t.md'), 'utf8').split('\n')
  const lineNo = text.findIndex((l) => l.includes('src/loop.ts')) + 1
  expect(r.stdout).toMatch(/^02-t\.md: shape: touches: /m)
  expect(r.stdout).toMatch(new RegExp(`^03-t\\.md: no-file-paths: .*line ${lineNo}.*src/loop\\.ts`, 'm'))
  expect(r.stdout).toMatch(/^01-t\.md: touches: /m)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket failing its own checks does not count in set checks', () => {
  project(3)
  put({ n: 1, cites: 'map-reopen', stories: '1, 2' })
  put({ n: 2, cites: 'map-stale', stories: '3', what: null })
  put({ n: 4, cites: 'map-reopen', blocked: '2', stories: '1' })
  const r = check()
  console.log(r.stdout)
  expect(r.stdout).toMatch(/^02-t\.md: shape: What to build: /m)
  expect(r.stdout).toMatch(/^ticket set: cards-cited: .*#?map-stale/m)
  expect(r.stdout).toMatch(/^ticket set: stories: .*story 3/m)
  expect(r.stdout).toMatch(/^04-t\.md: blocked_by: .*2/m)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors', () => {
  project(4)
  put({ n: 1, cites: 'map-stale', stories: '1, 9' })
  put({ n: 2, cites: 'map-stale', blocked: '3', stories: '2' })
  put({ n: 3, cites: 'map-stale', blocked: '2', stories: '3' })
  put({ n: 4, cites: 'map-stale', stories: '1' })
  put({ n: 5, cites: 'map-stale', blocked: '8', stories: '2' })
  const r = check()
  console.log(r.stdout)
  expect(r.stdout).toMatch(/cards-cited: .*map-reopen/)
  expect(r.stdout).toMatch(/stories: .*story 4/)
  expect(r.stdout).toMatch(/story 9/)
  expect(r.stdout).toMatch(/^02-t\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^03-t\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^05-t\.md: blocked_by: .*8/m)
  expect(r.stdout).not.toMatch(/^0[14]-t\.md: blocked_by:/m)
  expect(r.code).not.toBe(0)
})

test('80.5 fixing the only failure makes the check pass', () => {
  project(3)
  put({ n: 1, cites: 'map-reopen', stories: '1' })
  put({ n: 2, cites: 'map-stale', blocked: '1', stories: '2' })
  const before = check()
  console.log(before.stdout)
  expect(failLines(before.stdout)).toHaveLength(1)
  expect(before.stdout).toMatch(/story 3/)
  put({ n: 2, cites: 'map-stale', blocked: '1', stories: '2, 3' })
  const r = check()
  expect(failLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})
