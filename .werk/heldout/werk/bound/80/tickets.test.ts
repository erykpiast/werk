/** Held-out tests for the ticket check: 80.x. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../src/test/harness.ts'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))

function ok(p: Project, args: string[]) {
  const r = p.werk(args)
  if (r.code !== 0) throw new Error(`werk ${args.join(' ')} exited ${r.code}: ${r.stderr}`)
  return r
}

/** A project with a real root card "map" and the given decided real cards under it. */
function mapWith(decided: string[]): Project {
  const p = makeProject()
  cleanups.push(p.cleanup)
  ok(p, ['add', 'map', '--title', 'Map'])
  ok(p, ['accept', 'map', '--actor', 'you'])
  for (const id of decided) {
    ok(p, ['add', id, '--title', `Card ${id}`, '--parent', 'map', '--status', 'decided'])
    ok(p, ['accept', id, '--actor', 'you'])
  }
  return p
}

function spec(p: Project, n: number): string {
  const lines = ['# Spec', '', '## Problem Statement', '', 'A problem.', '', '## User Stories', '']
  for (let i = 1; i <= n; i++) lines.push(`${i}. As a person, I want thing ${i}, so that it works.`)
  lines.push('', '## Implementation Decisions', '', '1. Not a story.', '')
  const file = join(p.dir, 'spec.md')
  writeFileSync(file, lines.join('\n'))
  return file
}

type T = { title: string; cites?: string; blocked?: string; stories?: string; touches?: string; what?: string }
const ticketText = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites ?? ''}`,
    `blocked_by: ${t.blocked ?? ''}`,
    `stories: ${t.stories ?? ''}`,
    `touches: ${t.touches ?? 'map view'}`,
    '',
    '## What to build',
    '',
    t.what ?? 'A person does a thing in the map.',
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

function folder(p: Project, tickets: Record<string, T>): string {
  const dir = join(p.dir, 'tickets')
  mkdirSync(dir, { recursive: true })
  for (const [name, t] of Object.entries(tickets)) writeFileSync(join(dir, name), ticketText(t))
  return dir
}

const failureLines = (out: string) => out.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check:'))

test('80.1 a folder of valid tickets passes', () => {
  const p = mapWith(['map-reopen', 'map-stale'])
  const s = spec(p, 3)
  const dir = folder(p, {
    '01-reopen.md': { title: 'Reopen', cites: 'map-reopen', stories: '1, 2', touches: 'map view' },
    '02-stale.md': { title: 'Stale', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' },
  })
  const r = p.werk(['ticket-check', dir, '--root', 'map', '--spec', s])
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})

test('80.2 own-check failures name their ticket', () => {
  const p = mapWith(['map-reopen', 'map-stale'])
  const s = spec(p, 3)
  const dir = folder(p, {
    '01-reopen.md': { title: 'Reopen', cites: 'map-reopen', stories: '1, 2', touches: 'map view' },
    '02-stale.md': { title: 'Stale', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' },
    '03-prefactor.md': { title: 'Prefactor', blocked: '1', touches: 'fold' },
  })
  const pass = p.werk(['ticket-check', dir, '--root', 'map', '--spec', s])
  expect(pass.code).toBe(0)

  const edit = (name: string, f: (text: string) => string) => writeFileSync(join(dir, name), f(readFileSync(join(dir, name), 'utf8')))
  edit('02-stale.md', (t) => t.replace(/^touches:.*\n/m, ''))
  edit('03-prefactor.md', (t) => t.replace('A person does a thing in the map.', 'A person does a thing in the map.\nedit src/loop.ts'))
  edit('01-reopen.md', (t) => t.replace(/^touches:.*$/m, 'touches: map view, server/routes'))
  const pathLine = readFileSync(join(dir, '03-prefactor.md'), 'utf8').split('\n').indexOf('edit src/loop.ts') + 1

  const r = p.werk(['ticket-check', dir, '--root', 'map', '--spec', s])
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: touches:'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-prefactor.md: no-file-paths:') && l.includes('"src/loop.ts"') && l.includes(`line ${pathLine}`))).toBe(true)
  expect(lines.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  const p = mapWith(['map-reopen', 'map-stale'])
  const s = spec(p, 3)
  const dir = folder(p, {
    '01-reopen.md': { title: 'Reopen', cites: 'map-reopen', stories: '1, 2' },
    '02-stale.md': { title: 'Stale', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' },
    '04-after.md': { title: 'After', blocked: '2', touches: 'board' },
  })
  expect(p.werk(['ticket-check', dir, '--root', 'map', '--spec', s]).code).toBe(0)
  const f = join(dir, '02-stale.md')
  writeFileSync(f, readFileSync(f, 'utf8').replace('## What to build\n', ''))

  const r = p.werk(['ticket-check', dir, '--root', 'map', '--spec', s])
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: What to build:'))).toBe(true)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('map-stale'))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && /no ticket delivers story 3\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('04-after.md: blocked_by:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  const p = mapWith(['map-reopen', 'map-stale'])
  const s = spec(p, 4)
  const dir = folder(p, {
    '01-one.md': { title: 'One', cites: 'map-stale', stories: '1, 9' },
    '02-two.md': { title: 'Two', blocked: '3', stories: '2' },
    '03-three.md': { title: 'Three', blocked: '2', stories: '3' },
    '04-four.md': { title: 'Four', blocked: '1' },
    '05-five.md': { title: 'Five', blocked: '8' },
  })
  const r = p.werk(['ticket-check', dir, '--root', 'map', '--spec', s])
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('map-reopen'))).toBe(true)
  expect(lines.some((l) => /no ticket delivers story 4\b/.test(l))).toBe(true)
  expect(lines.some((l) => /story 9\b/.test(l) && l.includes('spec has no story 9'))).toBe(true)
  expect(lines.some((l) => l.startsWith('02-two.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-three.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('05-five.md: blocked_by:') && /\b8\b/.test(l))).toBe(true)
  expect(lines.some((l) => /^0[14]-\w+\.md: blocked_by:/.test(l))).toBe(false)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket and the next check passes', () => {
  const p = mapWith(['map-reopen', 'map-stale'])
  const s = spec(p, 3)
  const dir = folder(p, {
    '01-reopen.md': { title: 'Reopen', cites: 'map-reopen', stories: '1, 2' },
    '02-stale.md': { title: 'Stale', cites: 'map-stale', blocked: '1', stories: '', touches: 'decision log' },
  })
  const first = p.werk(['ticket-check', dir, '--root', 'map', '--spec', s])
  expect(failureLines(first.stdout)).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  const f = join(dir, '02-stale.md')
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^stories:.*$/m, 'stories: 3'))
  const r = p.werk(['ticket-check', dir, '--root', 'map', '--spec', s])
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})
