/** Held-out steps 80.x: the ticket-check verb, run as a process on ticket files this file writes. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'

let p: Project
afterEach(() => p?.cleanup())

/** Runs a CLI command and throws on a non-zero exit, so a broken Given is a binder error, not a pass. */
function must(args: string[]) {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r
}

/**
 * A project whose map has the root card "map" (open, so not decided) with the decided cards
 * map-reopen and map-stale under it, and one open card map-later. Built with the CLI.
 */
function project(): Project {
  p = makeProject()
  must(['add', 'map', '--title', 'The map'])
  must(['accept', 'map', '--actor', 'you'])
  for (const id of ['map-reopen', 'map-stale']) {
    must(['add', id, '--title', `Card ${id}`, '--parent', 'map', '--who', 'me'])
    must(['accept', id, '--actor', 'you'])
    must(['edit', id, '--no-basis', 'it stands alone'])
    must(['kill', id, '--form', 'manual', '--text', 'check it by use'])
    must(['status', id, 'decided'])
  }
  must(['add', 'map-later', '--title', 'Later', '--parent', 'map'])
  must(['accept', 'map-later', '--actor', 'you'])
  mkdirSync(join(p.dir, 'tickets'))
  return p
}

function spec(stories: number[]) {
  const lines = ['# Spec: the map', '', '## Problem Statement', '', 'Text.', '', '## User Stories', '']
  for (const n of stories) lines.push(`${n}. As a person, I want thing ${n}, so that I gain ${n}.`)
  lines.push('', '## Implementation Decisions', '', '1. Not a story.', '')
  writeFileSync(join(p.dir, 'spec.md'), lines.join('\n'))
}

type T = { title: string; cites: string; blocked?: string; stories: string; touches: string; what?: string }
function ticketText(t: T) {
  return [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    `stories: ${t.stories}`,
    `touches: ${t.touches}`,
    '',
    '## What to build',
    '',
    t.what ?? 'A person does a thing in the map, and the map shows it.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] The map shows the result.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
}
const path = (name: string) => join(p.dir, 'tickets', name)
const writeTicket = (name: string, t: T) => writeFileSync(path(name), ticketText(t))
const edit = (name: string, f: (s: string) => string) => {
  const before = readFileSync(path(name), 'utf8')
  const after = f(before)
  if (after === before) throw new Error(`binder: edit of ${name} changed nothing`)
  writeFileSync(path(name), after)
}

const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
/** The output lines that report a failure: every line except the summary line. */
const failureLines = (stdout: string) =>
  stdout
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.startsWith('ticket-check:'))

test('80.1 A folder of valid tickets passes the ticket check', () => {
  project()
  spec([1, 2, 3])
  writeTicket('01-reopen.md', { title: 'Reopen a decided card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' })
  writeTicket('02-stale.md', { title: 'Mark the stale cards', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' })
  const r = check()
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.code).toBe(0)
}, 60_000)

test('80.2 A ticket with a missing touches line and a path in its body fails its own checks by name', () => {
  project()
  spec([1, 2, 3])
  writeTicket('01-reopen.md', { title: 'Reopen a decided card', cites: 'map-reopen', stories: '1', touches: 'map view' })
  writeTicket('02-stale.md', { title: 'Mark the stale cards', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' })
  writeTicket('03-name.md', { title: 'Name the cause', cites: 'map-stale', blocked: '2', stories: '3', touches: 'map view' })
  const before = check()
  if (before.code !== 0) throw new Error(`binder: the Given set does not pass: ${before.stdout}`)

  edit('02-stale.md', (s) => s.replace('touches: decision log\n', ''))
  edit('03-name.md', (s) => s.replace('A person does a thing in the map, and the map shows it.', 'A person does a thing in the map, and the map shows it. edit src/loop.ts'))
  edit('01-reopen.md', (s) => s.replace('touches: map view', 'touches: map view, server/routes'))
  const line3 = readFileSync(path('03-name.md'), 'utf8').split('\n').findIndex((l) => l.includes('src/loop.ts')) + 1

  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: touches:'))).toBe(true)
  expect(
    lines.some((l) => l.startsWith('03-name.md: no-file-paths:') && l.includes('"src/loop.ts"') && l.includes(`line ${line3}`)),
  ).toBe(true)
  expect(lines.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
}, 60_000)

test('80.3 A ticket that fails its own checks does not count in the set checks', () => {
  project()
  spec([1, 2, 3])
  writeTicket('01-reopen.md', { title: 'Reopen a decided card', cites: 'map-reopen', stories: '1', touches: 'map view' })
  writeTicket('02-stale.md', { title: 'Mark the stale cards', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' })
  writeTicket('03-show.md', { title: 'Show the reopen', cites: 'map-reopen', blocked: '1', stories: '1', touches: 'map view' })
  writeTicket('04-after.md', { title: 'After the stale mark', cites: 'map-reopen', blocked: '2', stories: '2', touches: 'map view' })

  edit('02-stale.md', (s) => s.replace('## What to build\n', ''))
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: What to build:') && l.includes('missing'))).toBe(true)
  expect(lines.some((l) => l.includes('map-stale') && l.includes('cites') && /no ticket/.test(l))).toBe(true)
  expect(lines.some((l) => /no ticket delivers story 3\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('04-after.md: blocked_by:') && /\b2\b/.test(l))).toBe(true)
  expect(r.code).not.toBe(0)
}, 60_000)

test('80.4 A ticket set with coverage and order errors names each card, story and ticket', () => {
  project()
  spec([1, 2, 3, 4])
  writeTicket('01-first.md', { title: 'First', cites: 'map-stale', stories: '1, 9', touches: 'map view' })
  writeTicket('02-loop-a.md', { title: 'Loop A', cites: 'map-stale', blocked: '3', stories: '2', touches: 'map view' })
  writeTicket('03-loop-b.md', { title: 'Loop B', cites: 'map-stale', blocked: '2', stories: '3', touches: 'map view' })
  writeTicket('04-plain.md', { title: 'Plain', cites: 'map-stale', blocked: '1', stories: '1', touches: 'map view' })
  writeTicket('05-waits.md', { title: 'Waits', cites: 'map-stale', blocked: '8', stories: '2', touches: 'map view' })

  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('map-reopen'))).toBe(true)
  expect(lines.some((l) => /no ticket delivers story 4\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && /story 9\b/.test(l) && l.includes('spec has no story 9'))).toBe(true)
  expect(lines.some((l) => l.startsWith('02-loop-a.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-loop-b.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('05-waits.md: blocked_by:') && /\b8\b/.test(l))).toBe(true)
  expect(lines.filter((l) => /^0[14]-[a-z-]+\.md: blocked_by:/.test(l))).toEqual([])
  expect(r.code).not.toBe(0)
}, 60_000)

test('80.5 An agent fixes a ticket on request and the next ticket check passes', () => {
  project()
  spec([1, 2, 3])
  writeTicket('01-reopen.md', { title: 'Reopen a decided card', cites: 'map-reopen', stories: '1', touches: 'map view' })
  writeTicket('02-stale.md', { title: 'Mark the stale cards', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' })
  const first = check()
  const firstLines = failureLines(first.stdout)
  if (firstLines.length !== 1 || !/no ticket delivers story 3\b/.test(firstLines[0]!)) {
    throw new Error(`binder: the Given folder does not fail only on story 3: ${first.stdout}`)
  }

  // The agent's edit: ticket 2 lists story 3 too. There is no product verb for this; the test makes the edit the agent makes.
  edit('02-stale.md', (s) => s.replace('stories: 2', 'stories: 2, 3'))
  const r = check()
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
}, 60_000)
