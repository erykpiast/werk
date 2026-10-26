import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acc, project, prop, type P } from './cli-util.ts'

let p: P
afterEach(() => p?.cleanup())

type T = { title: string; cites: string; blocked: string; stories: string; touches?: string | null; what?: string | null }
function ticket(t: T): string {
  const head = [`title: ${t.title}`, `cites: ${t.cites}`, `blocked_by: ${t.blocked}`, `stories: ${t.stories}`]
  if (t.touches !== null) head.push(`touches: ${t.touches ?? 'map view'}`)
  const what = t.what === null ? [] : ['## What to build', '', t.what ?? 'A person sees the change on the map.', '']
  return [...head, '', ...what, '## Acceptance criteria', '', '- [ ] The change shows on the map.', '', '## Checks', '', '- `make test`', ''].join('\n')
}

function setup(stories: number[], tickets: Record<string, T>, extraDecided: string[] = []) {
  p = project()
  p.seed([
    prop('map', { title: 'Map', status: 'open' }), acc('map'),
    prop('map-reopen', { status: 'decided', parent: 'map' }),
    acc('map-reopen'),
    prop('map-stale', { status: 'decided', parent: 'map' }),
    acc('map-stale'),
    ...extraDecided.flatMap((id) => [prop(id, { status: 'decided', parent: 'map' }), acc(id)]),
  ])
  writeFileSync(
    join(p.dir, 'spec.md'),
    ['# Spec', '', '## User Stories', '', ...stories.map((n) => `${n}. As a person, I want story ${n}, so that it works.`), ''].join('\n'),
  )
  mkdirSync(join(p.dir, 'tickets'))
  for (const [name, t] of Object.entries(tickets)) writeFileSync(join(p.dir, 'tickets', name), ticket(t))
}
const check = () => p.w('ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md')
const failLines = (out: string) => out.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check:'))

test('80.1', () => {
  setup([1, 2, 3], {
    '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blocked: '', stories: '1, 2', touches: 'map view' },
    '02-stale.md': { title: 'Show stale marks', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' },
  })
  const r = check()
  console.log('80.1:', r.all)
  expect(failLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})

test('80.2', () => {
  setup([1, 2, 3], {
    '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blocked: '', stories: '1', touches: 'map view' },
    '02-stale.md': { title: 'Show stale marks', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' },
    '03-more.md': { title: 'More', cites: 'map-stale', blocked: '', stories: '3', touches: 'map view' },
  })
  expect(check().code).toBe(0)
  const f = (n: string) => join(p.dir, 'tickets', n)
  writeFileSync(f('02-stale.md'), readFileSync(f('02-stale.md'), 'utf8').replace(/^touches:.*\n/m, ''))
  writeFileSync(f('03-more.md'), readFileSync(f('03-more.md'), 'utf8').replace('## What to build\n\n', '## What to build\n\nedit src/loop.ts\n'))
  writeFileSync(f('01-reopen.md'), readFileSync(f('01-reopen.md'), 'utf8').replace(/^touches:.*$/m, 'touches: map view, server/routes'))
  const r = check()
  console.log('80.2:', r.all)
  const lineNo = readFileSync(f('03-more.md'), 'utf8').split('\n').indexOf('edit src/loop.ts') + 1
  expect(r.stdout).toMatch(/^02-stale\.md: shape: touches:/m)
  expect(r.stdout).toMatch(new RegExp(`^03-more\\.md: no-file-paths: .*line ${lineNo}.*src/loop\\.ts`, 'm'))
  expect(r.stdout).toMatch(/^01-reopen\.md: touches:/m)
  expect(r.code).not.toBe(0)
})

test('80.3', () => {
  setup([1, 2, 3], {
    '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blocked: '', stories: '1', touches: 'map view' },
    '02-stale.md': { title: 'Show stale marks', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' },
    '03-more.md': { title: 'More', cites: 'map-reopen', blocked: '', stories: '2', touches: 'map view' },
    '04-after.md': { title: 'After', cites: 'map-reopen', blocked: '2', stories: '1', touches: 'map view' },
  })
  expect(check().code).toBe(0)
  const f = join(p.dir, 'tickets', '02-stale.md')
  writeFileSync(f, readFileSync(f, 'utf8').replace('## What to build\n', ''))
  const r = check()
  console.log('80.3:', r.all)
  expect(r.stdout).toMatch(/^02-stale\.md: shape: What to build:/m)
  expect(r.stdout).toMatch(/cards-cited: .*map-stale/)
  expect(r.stdout).toMatch(/stories: .*story 3/)
  expect(r.stdout).toMatch(/^04-after\.md: blocked_by: .*2.*not .*in the set/m)
  expect(r.code).not.toBe(0)
})

test('80.4', () => {
  setup([1, 2, 3, 4], {
    '01-a.md': { title: 'A', cites: 'map-stale', blocked: '', stories: '1, 9' },
    '02-b.md': { title: 'B', cites: 'map-stale', blocked: '3', stories: '2' },
    '03-c.md': { title: 'C', cites: 'map-stale', blocked: '2', stories: '3' },
    '04-d.md': { title: 'D', cites: 'map-stale', blocked: '1', stories: '1' },
    '05-e.md': { title: 'E', cites: 'map-stale', blocked: '8', stories: '2' },
  })
  const r = check()
  console.log('80.4:', r.all)
  expect(r.stdout).toMatch(/cards-cited: .*map-reopen/)
  expect(r.stdout).toMatch(/story 4/)
  expect(r.stdout).toMatch(/story 9 .*(no story 9|unknown|not in)/)
  expect(r.stdout).toMatch(/^02-b\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^03-c\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^05-e\.md: blocked_by: .*8/m)
  const blockedBy = r.stdout.split('\n').filter((l) => /: blocked_by: /.test(l))
  expect(blockedBy.some((l) => l.startsWith('01-a.md') || l.startsWith('04-d.md'))).toBe(false)
  expect(r.code).not.toBe(0)
})

test('80.5', () => {
  setup([1, 2, 3], {
    '01-reopen.md': { title: 'Reopen a card', cites: 'map-reopen', blocked: '', stories: '1', touches: 'map view' },
    '02-stale.md': { title: 'Show stale marks', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' },
  })
  const first = check()
  console.log('80.5 before:', first.all)
  expect(failLines(first.stdout)).toHaveLength(1)
  expect(first.stdout).toMatch(/story 3/)
  const f = join(p.dir, 'tickets', '02-stale.md')
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^stories: 2$/m, 'stories: 2, 3'))
  const r = check()
  expect(failLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})
