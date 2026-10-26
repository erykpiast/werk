import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
import { makeProject, writeLog, type Project } from './common.ts'

let p: Project
afterEach(() => p?.cleanup())

type T = { title: string; cites: string; blocked: string; stories: string; touches?: string | null; what?: string; noWhat?: boolean }

function ticketText(t: T): string {
  return [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked}`,
    `stories: ${t.stories}`,
    ...(t.touches === null ? [] : [`touches: ${t.touches ?? 'map view'}`]),
    '',
    ...(t.noWhat ? [] : ['## What to build', '', t.what ?? 'A person sees the change in the map.', '']),
    '## Acceptance criteria',
    '',
    '- [ ] The change shows.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
}

function setup(cards: string[], stories: number[], tickets: Record<string, T>) {
  p = makeProject()
  writeLog(p, logOf(proposed('map', { status: 'open' }), ...cards.map((c) => proposed(c, { status: 'decided', parent: 'map' })), ...cards.map(accepted)))
  const spec = ['# Spec', '', '## User Stories', '', ...stories.map((n) => `${n}. As a person, I want thing ${n}, so that it works.`), ''].join('\n')
  writeFileSync(join(p.dir, 'spec.md'), spec)
  mkdirSync(join(p.dir, 'tickets'))
  for (const [name, t] of Object.entries(tickets)) writeFileSync(join(p.dir, 'tickets', name), ticketText(t))
}
const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const lines = (out: string, prefix: string) => out.split('\n').filter((l) => l.startsWith(prefix))

test('80.1 a folder of valid tickets passes the ticket check', () => {
  setup(['map-reopen', 'map-stale'], [1, 2, 3], {
    '1-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blocked: '', stories: '1, 2', touches: 'map view' },
    '2-stale.md': { title: 'Stale marks', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' },
  })
  const r = check()
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.stdout).not.toMatch(/^.*\.md: /m)
  expect(r.stdout).not.toContain('ticket set:')
  expect(r.code).toBe(0)
})

test('80.2 a missing touches line and a path in the body fail their own checks by name', () => {
  setup(['map-reopen', 'map-stale'], [1, 2, 3], {
    '1-a.md': { title: 'One', cites: 'map-reopen', blocked: '', stories: '1', touches: 'map view' },
    '2-b.md': { title: 'Two', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' },
    '3-c.md': { title: 'Three', cites: 'map-stale', blocked: '', stories: '3', touches: 'stale marks' },
  })
  expect(check().code).toBe(0)
  // The person's edits.
  const f = (n: string) => join(p.dir, 'tickets', n)
  writeFileSync(f('2-b.md'), readFileSync(f('2-b.md'), 'utf8').replace(/^touches:.*\n/m, ''))
  writeFileSync(f('3-c.md'), readFileSync(f('3-c.md'), 'utf8').replace('A person sees the change in the map.', 'A person sees the change in the map.\nedit src/loop.ts'))
  writeFileSync(f('1-a.md'), readFileSync(f('1-a.md'), 'utf8').replace(/^touches:.*$/m, 'touches: map view, server/routes'))
  const pathLine = readFileSync(f('3-c.md'), 'utf8').split('\n').findIndex((l) => l === 'edit src/loop.ts') + 1
  const r = check()
  const t2 = lines(r.stdout, '2-b.md:')
  expect(t2.some((l) => l.includes('shape') && l.includes('touches'))).toBe(true)
  const t3 = lines(r.stdout, '3-c.md:')
  expect(t3.some((l) => l.includes('no-file-paths') && l.includes('src/loop.ts') && l.includes(`line ${pathLine}`))).toBe(true)
  const t1 = lines(r.stdout, '1-a.md:')
  expect(t1.some((l) => l.includes(': touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  setup(['map-reopen', 'map-stale'], [1, 2, 3], {
    '1-a.md': { title: 'One', cites: 'map-reopen', blocked: '', stories: '1', touches: 'map view' },
    '2-b.md': { title: 'Two', cites: 'map-stale', blocked: '', stories: '3', touches: 'decision log' },
    '3-c.md': { title: 'Three', cites: 'map-reopen', blocked: '1', stories: '2', touches: 'stale marks' },
    '4-d.md': { title: 'Four', cites: 'map-reopen', blocked: '2', stories: '2', touches: 'board' },
  })
  expect(check().code).toBe(0)
  const f = join(p.dir, 'tickets', '2-b.md')
  writeFileSync(f, readFileSync(f, 'utf8').replace('## What to build\n', ''))
  const r = check()
  expect(lines(r.stdout, '2-b.md:').some((l) => l.includes('shape') && l.includes('What to build'))).toBe(true)
  expect(r.stdout).toMatch(/ticket set: cards-cited: .*#?map-stale/)
  expect(r.stdout).toMatch(/ticket set: stories: .*story 3/)
  expect(lines(r.stdout, '4-d.md:').some((l) => l.includes('blocked_by') && l.includes('2'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  setup(['map-reopen', 'map-stale'], [1, 2, 3, 4], {
    '1-a.md': { title: 'One', cites: 'map-stale', blocked: '', stories: '1, 9', touches: 'map view' },
    '2-b.md': { title: 'Two', cites: 'map-stale', blocked: '3', stories: '2', touches: 'map view' },
    '3-c.md': { title: 'Three', cites: 'map-stale', blocked: '2', stories: '3', touches: 'map view' },
    '4-d.md': { title: 'Four', cites: 'map-stale', blocked: '1', stories: '3', touches: 'map view' },
    '5-e.md': { title: 'Five', cites: 'map-stale', blocked: '8', stories: '1', touches: 'map view' },
  })
  const r = check()
  expect(r.stdout).toMatch(/cards-cited: .*map-reopen/)
  expect(r.stdout).toMatch(/no ticket delivers story 4/)
  expect(r.stdout).toMatch(/story 9 .*no story 9|story 9.*unknown|unknown.*story 9/)
  const blocked = lines(r.stdout, '').filter((l) => l.includes(': blocked_by:'))
  expect(blocked.some((l) => l.startsWith('2-b.md') && /cycle/.test(l))).toBe(true)
  expect(blocked.some((l) => l.startsWith('3-c.md') && /cycle/.test(l))).toBe(true)
  expect(blocked.some((l) => l.startsWith('5-e.md') && l.includes('8'))).toBe(true)
  expect(blocked.some((l) => l.startsWith('1-a.md'))).toBe(false)
  expect(blocked.some((l) => l.startsWith('4-d.md'))).toBe(false)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next check passes', () => {
  setup(['map-reopen', 'map-stale'], [1, 2, 3], {
    '1-a.md': { title: 'One', cites: 'map-reopen', blocked: '', stories: '1', touches: 'map view' },
    '2-b.md': { title: 'Two', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' },
  })
  const first = check()
  expect(first.code).not.toBe(0)
  const failing = first.stdout.split('\n').filter((l) => /^(.*\.md|ticket set): /.test(l))
  expect(failing).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  const f = join(p.dir, 'tickets', '2-b.md')
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^stories: 2$/m, 'stories: 2, 3'))
  const r = check()
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.code).toBe(0)
})
