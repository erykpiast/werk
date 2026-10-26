import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { project, type P } from './helpers.ts'

let p: P
afterEach(() => p?.cleanup())

type T = { title: string; cites: string; blocked: string; stories: string; touches: string; what?: string }

const ticketText = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked}`,
    `stories: ${t.stories}`,
    `touches: ${t.touches}`,
    '',
    '## What to build',
    '',
    t.what ?? `Build ${t.title.toLowerCase()}.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] It works for a person.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

const spec = (n: number) =>
  ['# Spec', '', '## User Stories', '', ...Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}.`), '', '## Other', ''].join('\n')

/** The map: root "map" (open) with decided children map-reopen and map-stale. */
function setup(tickets: Record<string, T>, stories = 3) {
  p = project()
  p.writeLog([
    { type: 'node.proposed', payload: { id: 'map', kind: 'card', title: 'The map', status: 'open' } },
    { type: 'node.proposed', payload: { id: 'map-reopen', kind: 'card', title: 'Reopen', status: 'decided', parent: 'map' } },
    { type: 'node.proposed', payload: { id: 'map-stale', kind: 'card', title: 'Stale', status: 'decided', parent: 'map' } },
    { type: 'node.accepted', payload: { id: 'map' } },
    { type: 'node.accepted', payload: { id: 'map-reopen' } },
    { type: 'node.accepted', payload: { id: 'map-stale' } },
  ])
  mkdirSync(join(p.dir, 'tickets'))
  writeFileSync(join(p.dir, 'spec.md'), spec(stories))
  for (const [name, t] of Object.entries(tickets)) writeFileSync(join(p.dir, 'tickets', name), ticketText(t))
}

const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const failureLines = (out: string) => out.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check: '))
const file = (name: string) => join(p.dir, 'tickets', name)

test('80.1 a folder of valid tickets passes the ticket check', () => {
  setup({
    '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blocked: '', stories: '1, 2', touches: 'map view' },
    '02-stale.md': { title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' },
  })
  const r = check()
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.stdout).toMatch(/0 failure\(s\)/)
  expect(r.code).toBe(0)
})

const three = (): Record<string, T> => ({
  '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blocked: '', stories: '1', touches: 'map view' },
  '02-stale.md': { title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' },
  '03-loop.md': { title: 'Run the loop', cites: '', blocked: '2', stories: '3', touches: 'loop' },
})

test('80.2 a ticket with a missing touches line and a path in its body fails its own checks by name', () => {
  setup(three())
  expect(check().code).toBe(0)
  const t2 = readFileSync(file('02-stale.md'), 'utf8')
  writeFileSync(file('02-stale.md'), t2.replace(/^touches:.*\n/m, ''))
  const t3 = readFileSync(file('03-loop.md'), 'utf8')
  writeFileSync(file('03-loop.md'), t3.replace('Build run the loop.', 'Build run the loop.\nedit src/loop.ts'))
  const pathLine = readFileSync(file('03-loop.md'), 'utf8').split('\n').indexOf('edit src/loop.ts') + 1
  const t1 = readFileSync(file('01-reopen.md'), 'utf8')
  writeFileSync(file('01-reopen.md'), t1.replace('touches: map view', 'touches: map view, server/routes'))
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: touches:'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-loop.md: no-file-paths:') && l.includes('"src/loop.ts"') && l.includes(`line ${pathLine}`))).toBe(true)
  expect(lines.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  setup({
    '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blocked: '', stories: '1, 2', touches: 'map view' },
    '02-stale.md': { title: 'Mark stale cards', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' },
    '04-after.md': { title: 'After the stale marks', cites: '', blocked: '2', stories: '', touches: 'map view' },
  })
  expect(check().code).toBe(0)
  writeFileSync(file('02-stale.md'), readFileSync(file('02-stale.md'), 'utf8').replace('## What to build\n', ''))
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: What to build:'))).toBe(true)
  expect(lines.some((l) => /cards-cited/.test(l) && l.includes('#map-stale'))).toBe(true)
  expect(lines.some((l) => /stories/.test(l) && /story 3\b/.test(l) && /no ticket delivers/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('04-after.md: blocked_by:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 a ticket set with coverage and order errors names each card, story and ticket', () => {
  setup(
    {
      '01-a.md': { title: 'Ticket one', cites: 'map-stale', blocked: '', stories: '1, 9', touches: 'map view' },
      '02-b.md': { title: 'Ticket two', cites: '', blocked: '3', stories: '2', touches: 'map view' },
      '03-c.md': { title: 'Ticket three', cites: '', blocked: '2', stories: '3', touches: 'map view' },
      '04-d.md': { title: 'Ticket four', cites: '', blocked: '1', stories: '', touches: 'map view' },
      '05-e.md': { title: 'Ticket five', cites: '', blocked: '8', stories: '', touches: 'map view' },
    },
    4,
  )
  const r = check()
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => /cards-cited/.test(l) && l.includes('#map-reopen'))).toBe(true)
  expect(lines.some((l) => /story 4\b/.test(l) && /no ticket delivers/.test(l))).toBe(true)
  expect(lines.some((l) => /story 9\b/.test(l) && /spec has no story 9/.test(l))).toBe(true)
  const blocked = lines.filter((l) => / blocked_by: /.test(l))
  expect(blocked.some((l) => l.startsWith('02-b.md') && /cycle/.test(l))).toBe(true)
  expect(blocked.some((l) => l.startsWith('03-c.md') && /cycle/.test(l))).toBe(true)
  expect(blocked.some((l) => l.startsWith('05-e.md') && /8/.test(l))).toBe(true)
  expect(blocked.filter((l) => l.startsWith('01-a.md') || l.startsWith('04-d.md'))).toEqual([])
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next ticket check passes', () => {
  const set = three()
  set['02-stale.md']!.stories = '2'
  set['03-loop.md']!.stories = ''
  setup(set)
  const first = check()
  const firstLines = failureLines(first.stdout)
  expect(firstLines.length).toBe(1)
  expect(firstLines[0]).toMatch(/story 3/)
  writeFileSync(file('02-stale.md'), readFileSync(file('02-stale.md'), 'utf8').replace('stories: 2', 'stories: 2, 3'))
  const r = check()
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})
