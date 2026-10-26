/** Held-out steps 107.* and 80.*: the ticket-check verb. */
import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

type T = {
  title: string
  cites: string
  blockedBy?: string
  stories: string
  touches?: string | null
  build?: string
  noAcceptance?: boolean
  noWhatToBuild?: boolean
}

function ticketText(t: T): string {
  const lines = [`title: ${t.title}`, `cites: ${t.cites}`, `blocked_by: ${t.blockedBy ?? ''}`, `stories: ${t.stories}`]
  if (t.touches !== null) lines.push(`touches: ${t.touches ?? 'map view'}`)
  lines.push('')
  if (!t.noWhatToBuild) lines.push('## What to build', '')
  lines.push(t.build ?? 'A person opens a card and presses a button. The card changes.', '')
  if (!t.noAcceptance) lines.push('## Acceptance criteria', '')
  lines.push('- [ ] The card shows the change.', '', '## Checks', '', '- `make test`', '')
  return lines.join('\n')
}

/** A project whose map holds a decided subtree under "map" with the given decided cards. */
function project(decided: string[], extraOpen: string[] = []): Project {
  const p = makeProject()
  const log = logOf(
    proposed('map', { status: 'decided' }),
    ...decided.map((id) => proposed(id, { status: 'decided', parent: 'map' })),
    ...extraOpen.map((id) => proposed(id, { status: 'open', parent: 'map' })),
    ...decided.map((id) => accepted(id)),
    ...extraOpen.map((id) => accepted(id)),
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  mkdirSync(join(p.dir, 'tickets'))
  return p
}

function spec(p: Project, stories: number[]): void {
  const body = ['# Spec', '', '## Problem Statement', '', 'A problem.', '', '## User Stories', '']
  for (const n of stories) body.push(`${n}. As a person, I want thing ${n}, so that I get value ${n}.`)
  body.push('', '## Implementation Decisions', '', 'None.', '')
  writeFileSync(join(p.dir, 'spec.md'), body.join('\n'))
}

const put = (p: Project, name: string, t: T) => writeFileSync(join(p.dir, 'tickets', name), ticketText(t))
const check = (p: Project, specFile = 'spec.md') => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', specFile])
const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr
const linesWith = (text: string, needle: string) => text.split('\n').filter((l) => l.includes(needle))

/** A valid set: map, map-reopen, map-stale decided; stories 1..3. */
function validSet(): Project {
  const p = project(['map-reopen', 'map-stale'])
  spec(p, [1, 2, 3])
  put(p, '01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen, #map', stories: '1, 2', touches: 'map view' })
  put(p, '02-stale.md', { title: 'Show stale marks', cites: 'map-stale', blockedBy: '1', stories: '3', touches: 'decision log' })
  return p
}

// ---- 107 ----

test('107.1 a valid ticket set passes the ticket check', () => {
  const p = validSet()
  const r = check(p)
  expect(r.code).toBe(0)
  expect(r.stdout).toContain('0 failure(s) in all')
  expect(out(r)).not.toMatch(/^.*\.md: /m)
  expect(out(r)).not.toContain('ticket set:')
})

test('107.2 a ticket that fails its shape check makes the run fail', () => {
  const p = validSet()
  put(p, '02-stale.md', { title: 'Show stale marks', cites: 'map-stale', blockedBy: '1', stories: '3', touches: 'decision log', noAcceptance: true })
  const r = check(p)
  expect(r.code).toBe(1)
  expect(r.stdout).toMatch(/^02-stale\.md: shape: Acceptance criteria: .*## Acceptance criteria/m)
  expect(r.stdout).not.toMatch(/^01-reopen\.md: /m)
})

test('107.3 a call with a missing spec cannot run the checks and says so', () => {
  const p = validSet()
  const r = check(p, 'no-such-spec.md')
  expect(r.code).toBe(2)
  expect(out(r)).toContain('no-such-spec.md')
  expect(r.code).not.toBe(0)
  expect(r.code).not.toBe(1)
})

test('107.4 an uncited decided card is reported against the ticket set', () => {
  const p = project(['map-reopen', 'map-stale', 'map-uncited'])
  spec(p, [1, 2, 3])
  put(p, '01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen, #map', stories: '1, 2', touches: 'map view' })
  put(p, '02-stale.md', { title: 'Show stale marks', cites: 'map-stale', blockedBy: '1', stories: '3', touches: 'decision log' })
  const r = check(p)
  expect(r.code).toBe(1)
  const about = linesWith(r.stdout, 'map-uncited')
  expect(about).toHaveLength(1)
  expect(about[0]).toMatch(/^ticket set: cards-cited: /)
  expect(about[0]).not.toMatch(/\d\d-\w+\.md/)
})

test('107.5 an undelivered story is reported against the ticket set', () => {
  const p = validSet()
  spec(p, [1, 2, 3, 4])
  const r = check(p)
  expect(r.code).toBe(1)
  const about = r.stdout.split('\n').filter((l) => /\bstory 4\b/.test(l))
  expect(about).toHaveLength(1)
  expect(about[0]).toMatch(/^ticket set: stories: /)
  expect(about[0]).not.toMatch(/\d\d-\w+\.md/)
})

// ---- 80 ----

test('80.1 a folder of valid tickets passes the ticket check', () => {
  const p = validSet()
  const r = check(p)
  expect(out(r)).not.toMatch(/^.*\.md: /m)
  expect(out(r)).not.toContain('ticket set:')
  expect(r.stdout).toContain('0 failure(s) in all')
  expect(r.code).toBe(0)
})

/** Three tickets that pass every check together. */
function threeSet(): Project {
  const p = project(['map-reopen', 'map-stale'])
  spec(p, [1, 2, 3])
  put(p, '01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen, #map', stories: '1', touches: 'map view' })
  put(p, '02-stale.md', { title: 'Show stale marks', cites: 'map-stale', blockedBy: '1', stories: '2', touches: 'decision log' })
  put(p, '03-name.md', { title: 'Name the cause', cites: 'map-stale', blockedBy: '2', stories: '3', touches: 'stale marks' })
  return p
}

test('80.2 a ticket with a missing touches line and a path in its body fails its own checks by name', () => {
  const p = threeSet()
  expect(check(p).code).toBe(0)
  put(p, '02-stale.md', { title: 'Show stale marks', cites: 'map-stale', blockedBy: '1', stories: '2', touches: null })
  const t3 = join(p.dir, 'tickets', '03-name.md')
  const text3 = readFileSync(t3, 'utf8').split('\n')
  const at = text3.indexOf('## What to build') + 2
  text3.splice(at, 0, 'edit src/loop.ts')
  writeFileSync(t3, text3.join('\n'))
  const pathLine = at + 1
  put(p, '01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen, #map', stories: '1', touches: 'map view, server/routes' })
  const r = check(p)
  expect(r.stdout).toMatch(/^02-stale\.md: shape: touches: /m)
  expect(r.stdout).toMatch(new RegExp(`^03-name\\.md: no-file-paths: .*line ${pathLine}\\b.*"src/loop\\.ts"`, 'm'))
  expect(r.stdout).toMatch(/^01-reopen\.md: touches: /m)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  const p = project(['map-reopen', 'map-stale'])
  spec(p, [1, 2, 3])
  put(p, '01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen, #map', stories: '1, 2', touches: 'map view' })
  put(p, '02-stale.md', { title: 'Show stale marks', cites: 'map-stale', blockedBy: '1', stories: '3', touches: 'decision log' })
  put(p, '04-after.md', { title: 'After stale', cites: 'map-reopen', blockedBy: '2', stories: '1', touches: 'board' })
  expect(check(p).code).toBe(0)
  put(p, '02-stale.md', { title: 'Show stale marks', cites: 'map-stale', blockedBy: '1', stories: '3', touches: 'decision log', noWhatToBuild: true })
  const r = check(p)
  expect(r.stdout).toMatch(/^02-stale\.md: shape: What to build: /m)
  expect(r.stdout).toMatch(/^ticket set: cards-cited: .*map-stale/m)
  expect(r.stdout).toMatch(/^ticket set: stories: .*story 3\b/m)
  expect(r.stdout).toMatch(/^04-after\.md: blocked_by: /m)
  expect(r.code).not.toBe(0)
})

test('80.4 a ticket set with coverage and order errors names each card, story and ticket', () => {
  const p = project(['map-reopen', 'map-stale'])
  spec(p, [1, 2, 3, 4])
  put(p, '01-one.md', { title: 'One', cites: 'map-stale', stories: '1, 9', touches: 'a' })
  put(p, '02-two.md', { title: 'Two', cites: 'map-stale', blockedBy: '3', stories: '2', touches: 'b' })
  put(p, '03-three.md', { title: 'Three', cites: 'map-stale', blockedBy: '2', stories: '3', touches: 'c' })
  put(p, '04-four.md', { title: 'Four', cites: '#map', blockedBy: '1', stories: '1', touches: 'd' })
  put(p, '05-five.md', { title: 'Five', cites: 'map-stale', blockedBy: '8', stories: '2', touches: 'e' })
  const r = check(p)
  expect(r.stdout).toMatch(/cards-cited: .*map-reopen/)
  expect(r.stdout).toMatch(/stories: .*story 4\b/)
  expect(r.stdout.split('\n').some((l) => /\b9\b/.test(l) && /stor/.test(l))).toBe(true)
  expect(r.stdout).toMatch(/^02-two\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^03-three\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^05-five\.md: blocked_by: .*\b8\b/m)
  expect(r.stdout).not.toMatch(/^01-one\.md: blocked_by:/m)
  expect(r.stdout).not.toMatch(/^04-four\.md: blocked_by:/m)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next ticket check passes', () => {
  const p = project(['map-reopen', 'map-stale'])
  spec(p, [1, 2, 3])
  put(p, '01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen, #map', stories: '1', touches: 'map view' })
  put(p, '02-stale.md', { title: 'Show stale marks', cites: 'map-stale', blockedBy: '1', stories: '2', touches: 'decision log' })
  const before = check(p)
  expect(before.code).toBe(1)
  expect(before.stdout.split('\n').filter((l) => l.includes(': ') && !l.startsWith('ticket-check:'))).toEqual([
    expect.stringMatching(/story 3/),
  ])
  const f = join(p.dir, 'tickets', '02-stale.md')
  writeFileSync(f, readFileSync(f, 'utf8').replace('stories: 2', 'stories: 2, 3'))
  const r = check(p)
  expect(out(r)).not.toMatch(/^.*\.md: /m)
  expect(out(r)).not.toContain('ticket set:')
  expect(r.code).toBe(0)
  rmSync(join(p.dir, 'tickets'), { recursive: true, force: true })
})
