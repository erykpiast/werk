import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

type T = {
  title?: string
  cites?: string
  blocked_by?: string
  stories?: string
  touches?: string
  what?: string
  omit?: string[]
}

function ticketText(t: T): string {
  const omit = new Set(t.omit ?? [])
  const lines: string[] = []
  const header: [string, string][] = [
    ['title', t.title ?? 'A person can do a thing'],
    ['cites', t.cites ?? ''],
    ['blocked_by', t.blocked_by ?? ''],
    ['stories', t.stories ?? ''],
    ['touches', t.touches ?? 'map view'],
  ]
  for (const [k, v] of header) if (!omit.has(k)) lines.push(`${k}: ${v}`)
  lines.push('')
  if (!omit.has('What to build')) lines.push('## What to build', '')
  lines.push(t.what ?? 'A person opens a card and does the thing.', '')
  if (!omit.has('Acceptance criteria')) lines.push('## Acceptance criteria', '')
  lines.push('- [ ] The thing works.', '')
  if (!omit.has('Checks')) lines.push('## Checks', '')
  lines.push('- `make test`', '')
  return lines.join('\n')
}

/** A project with map > decided cards; root "map" itself is open. */
function project(decided: string[] = ['map-reopen', 'map-stale']): Project {
  p = makeProject()
  const evs = [proposed('map', { status: 'open' })]
  for (const id of decided) evs.push(proposed(id, { status: 'decided', parent: 'map' }))
  for (const id of decided) evs.push(accepted(id))
  writeLog(evs)
  mkdirSync(join(p.dir, 'tickets'))
  return p
}
function writeLog(evs: ReturnType<typeof proposed>[]) {
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  const log = logOf(...evs)
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
}
function spec(stories: number[]) {
  const body = ['# Spec: a thing', '', '## Problem Statement', '', 'A problem.', '', '## User Stories', '']
  for (const n of stories) body.push(`${n}. As a person, I want thing ${n}, so that I gain ${n}.`)
  body.push('', '## Implementation Decisions', '', '1. Not a story.', '')
  writeFileSync(join(p.dir, 'spec.md'), body.join('\n'))
}
const put = (name: string, t: T) => writeFileSync(join(p.dir, 'tickets', name), ticketText(t))
const check = (specFile = 'spec.md') => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', specFile])
const outLines = (s: string) => s.trimEnd().split('\n').filter(Boolean)
const failLines = (s: string) => outLines(s).filter((l) => !l.startsWith('ticket-check:'))

/** The 107 valid set: three tickets for map-reopen, map-stale; stories 1..3. */
function valid107() {
  project()
  spec([1, 2, 3])
  put('01-reopen.md', { cites: 'map-reopen', stories: '1', touches: 'map view' })
  put('02-stale.md', { cites: 'map-stale', blocked_by: '1', stories: '2, 3', touches: 'decision log' })
  put('03-prefactor.md', { blocked_by: '1, 2', touches: 'fold' })
}

test('107.1 A valid ticket set passes the ticket check', () => {
  valid107()
  const r = check()
  console.log(r.stdout, r.stderr)
  expect(r.code).toBe(0)
  expect(failLines(r.stdout)).toEqual([])
  expect(r.stdout).toContain('0 failure(s) in all')
  expect(r.stderr).toBe('')
})

test('107.2 A ticket that fails its shape check makes the run fail', () => {
  valid107()
  put('03-prefactor.md', { blocked_by: '1, 2', touches: 'fold', omit: ['Acceptance criteria'] })
  const r = check()
  console.log(r.stdout, r.stderr)
  expect(r.code).toBe(1)
  expect(r.stdout).toContain('03-prefactor.md: shape: Acceptance criteria: the heading "## Acceptance criteria" is missing')
  const failed = failLines(r.stdout)
  expect(failed.filter((l) => l.startsWith('01-') || l.startsWith('02-'))).toEqual([])
  for (const l of failed) expect(l.startsWith('03-prefactor.md:') || l.startsWith('ticket set:')).toBe(true)
})

test('107.3 A call with a missing spec cannot run the checks and says so', () => {
  valid107()
  const r = check('no-such-spec.md')
  console.log(r.stdout, r.stderr)
  expect(r.code).toBe(2)
  expect(r.stdout + r.stderr).toContain('no-such-spec.md')
  expect(r.code).not.toBe(0)
  expect(r.code).not.toBe(1)
})

test('107.4 An uncited decided card is reported against the ticket set', () => {
  valid107()
  expect(check().code).toBe(0)
  writeLog([
    proposed('map', { status: 'open' }),
    proposed('map-reopen', { status: 'decided', parent: 'map' }),
    proposed('map-stale', { status: 'decided', parent: 'map' }),
    proposed('map-new', { status: 'decided', parent: 'map' }),
    accepted('map-reopen'),
    accepted('map-stale'),
    accepted('map-new'),
  ])
  const r = check()
  console.log(r.stdout, r.stderr)
  expect(r.code).toBe(1)
  const about = outLines(r.stdout).filter((l) => l.includes('map-new'))
  expect(about.length).toBe(1)
  const line = about[0]!
  expect(line.startsWith('ticket set: cards-cited:')).toBe(true)
  expect(line).toContain('map-new')
  expect(line).not.toMatch(/\d\d-[\w-]+\.md/)
})

test('107.5 An undelivered story is reported against the ticket set', () => {
  valid107()
  spec([1, 2, 3, 4])
  const r = check()
  console.log(r.stdout, r.stderr)
  expect(r.code).toBe(1)
  const about = failLines(r.stdout).filter((l) => /\bstory 4\b/.test(l))
  expect(about.length).toBe(1)
  const line = about[0]!
  expect(line.startsWith('ticket set: stories:')).toBe(true)
  expect(line).not.toMatch(/\d\d-[\w-]+\.md/)
})

test('80.1 A folder of valid tickets passes the ticket check', () => {
  project(['map-reopen', 'map-stale'])
  spec([1, 2, 3])
  put('01-reopen.md', { cites: 'map-reopen', stories: '1, 2', touches: 'map view' })
  put('02-stale.md', { cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' })
  const r = check()
  console.log(r.stdout, r.stderr)
  expect(failLines(r.stdout)).toEqual([])
  expect(r.stdout).toContain('0 failure(s) in all, against 2 decided card(s) and 3 story(ies)')
  expect(r.code).toBe(0)
})

/** 80.x passing set of three tickets. */
function valid80() {
  project(['map-reopen', 'map-stale'])
  spec([1, 2, 3])
  put('01-reopen.md', { cites: 'map-reopen', stories: '1, 2', touches: 'map view' })
  put('02-stale.md', { cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' })
  put('03-prefactor.md', { blocked_by: '1', touches: 'fold' })
}

test('80.2 A ticket with a missing touches line and a path in its body fails its own checks by name', () => {
  valid80()
  expect(check().code).toBe(0)
  put('02-stale.md', { cites: 'map-stale', blocked_by: '1', stories: '3', omit: ['touches'] })
  put('03-prefactor.md', { blocked_by: '1', touches: 'fold', what: 'A prefactor. edit src/loop.ts' })
  put('01-reopen.md', { cites: 'map-reopen', stories: '1, 2', touches: 'map view, server/routes' })
  const lineNo = readFileSync(join(p.dir, 'tickets', '03-prefactor.md'), 'utf8').split('\n').findIndex((l) => l.includes('src/loop.ts')) + 1
  const r = check()
  console.log(r.stdout, r.stderr)
  expect(r.stdout).toMatch(/^02-stale\.md: shape: touches: /m)
  expect(r.stdout).toContain(`03-prefactor.md: no-file-paths: What to build: line ${lineNo} names the file path "src/loop.ts"`)
  expect(r.stdout).toMatch(/^01-reopen\.md: touches: /m)
  expect(r.code).not.toBe(0)
})

test('80.3 A ticket that fails its own checks does not count in the set checks', () => {
  project(['map-reopen', 'map-stale'])
  spec([1, 2, 3])
  put('01-reopen.md', { cites: 'map-reopen', stories: '1, 2', touches: 'map view' })
  put('02-stale.md', { cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' })
  put('03-prefactor.md', { blocked_by: '1', touches: 'fold' })
  put('04-after.md', { blocked_by: '2', touches: 'board' })
  expect(check().code).toBe(0)
  put('02-stale.md', { cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log', omit: ['What to build'] })
  const r = check()
  console.log(r.stdout, r.stderr)
  expect(r.stdout).toContain('02-stale.md: shape: What to build: the heading "## What to build" is missing')
  expect(r.stdout).toContain('ticket set: cards-cited: cites: no ticket cites the decided card #map-stale')
  expect(r.stdout).toContain('ticket set: stories: stories: no ticket delivers story 3')
  expect(r.stdout).toMatch(/^04-after\.md: blocked_by: blocked_by: blocker 2 is not a ticket in the set/m)
  expect(r.code).not.toBe(0)
})

test('80.4 A ticket set with coverage and order errors names each card, story and ticket', () => {
  project(['map-reopen', 'map-stale'])
  spec([1, 2, 3, 4])
  put('01-one.md', { cites: 'map-stale', stories: '1, 9', touches: 'map view' })
  put('02-two.md', { blocked_by: '3', stories: '2', touches: 'board' })
  put('03-three.md', { blocked_by: '2', stories: '3', touches: 'fold' })
  put('04-four.md', { touches: 'decision log' })
  put('05-five.md', { blocked_by: '8', touches: 'stale marks' })
  const r = check()
  console.log(r.stdout, r.stderr)
  const lines = failLines(r.stdout)
  expect(lines.some((l) => l.startsWith('ticket set: cards-cited:') && l.includes('map-reopen'))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: stories:') && /no ticket delivers story 4\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: stories:') && /story 9 is listed, but the spec has no story 9/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('02-two.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-three.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('05-five.md: blocked_by:') && l.includes('blocker 8'))).toBe(true)
  const blocked = lines.filter((l) => /^[^:]+: blocked_by:/.test(l))
  expect(blocked.filter((l) => l.startsWith('01-one.md') || l.startsWith('04-four.md'))).toEqual([])
  expect(r.code).not.toBe(0)
})

test('80.5 An agent fixes a ticket on request and the next ticket check passes', () => {
  valid80()
  put('01-reopen.md', { cites: 'map-reopen', stories: '1, 2', touches: 'map view' })
  put('02-stale.md', { cites: 'map-stale', blocked_by: '1', stories: '', touches: 'decision log' })
  const before = check()
  expect(failLines(before.stdout)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  // The agent (the fake agent) edits ticket 2 on the person's request.
  p.scriptAgent({
    steps: [{ edit: { path: 'tickets/02-stale.md', content: ticketText({ cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' }) } }],
    exit: 0,
  } as never)
  const a = p.run(['claude', '-p', 'Change ticket 2 to list story 3, then run werk ticket-check again'])
  expect(a.code).toBe(0)
  expect(readFileSync(join(p.dir, 'tickets', '02-stale.md'), 'utf8')).toContain('stories: 3')
  const r = check()
  console.log(r.stdout, r.stderr)
  expect(failLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})
