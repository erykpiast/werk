/** Held-out steps 107.1-107.5 and 80.1-80.5: the ticket-check verb. */
import { expect, test } from 'bun:test'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

const FIXTURES = join(import.meta.dir, '..', '..', 'src', 'test', 'fixtures', 'tickets')

function writeLog(p: Project, events: ReturnType<typeof logOf>) {
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

const spec = (n: number) =>
  `# Spec: test\n\n## Problem Statement\n\nA problem.\n\n## User Stories\n\n${Array.from(
    { length: n },
    (_, i) => `${i + 1}. As a person, I want thing ${i + 1}, so that it works.`,
  ).join('\n')}\n\n## Implementation Decisions\n\n1. Not a story.\n`

type T = { title: string; cites: string; blocked?: string; stories: string; touches: string | null; what?: string; noWhatHeading?: boolean; noAcceptance?: boolean }
function ticket(t: T): string {
  const head = [`title: ${t.title}`, `cites: ${t.cites}`, `blocked_by: ${t.blocked ?? ''}`, `stories: ${t.stories}`]
  if (t.touches !== null) head.push(`touches: ${t.touches}`)
  const parts = [head.join('\n'), '']
  if (!t.noWhatHeading) parts.push('## What to build', '')
  parts.push(t.what ?? 'A person sees the thing work in the map.', '')
  if (!t.noAcceptance) parts.push('## Acceptance criteria', '', '- [ ] The thing shows in the map.', '')
  parts.push('## Checks', '', '- `make test`', '')
  return parts.join('\n')
}

const check = (p: Project, folder = 'tickets', root = 'map', specFile = 'spec.md') =>
  p.werk(['ticket-check', folder, '--root', root, '--spec', specFile])

/** The fixture-based valid set from the project's own fixtures: decided map, map-reopen, map-stale. */
function validFixtureProject(): Project {
  const p = makeProject()
  writeLog(
    p,
    logOf(
      proposed('map', { status: 'decided' }),
      proposed('map-reopen', { status: 'decided', parent: 'map' }),
      proposed('map-stale', { status: 'decided', parent: 'map' }),
      accepted('map-reopen'),
      accepted('map-stale'),
    ),
  )
  cpSync(join(FIXTURES, 'valid'), join(p.dir, 'tickets'), { recursive: true })
  cpSync(join(FIXTURES, 'spec.md'), join(p.dir, 'spec.md'))
  return p
}

const failureLines = (out: string) => out.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check:'))

test('107.1 a valid ticket set passes the ticket check', () => {
  const p = validFixtureProject()
  const r = check(p)
  expect(r.code).toBe(0)
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.stdout).toMatch(/0 failure\(s\)/)
})

test('107.2 a ticket with no Acceptance criteria heading makes the run fail and only it is named', () => {
  const p = validFixtureProject()
  const f = join(p.dir, 'tickets', '03-prefactor.md')
  writeFileSync(f, readFileSync(f, 'utf8').replace('## Acceptance criteria\n', ''))
  const r = check(p)
  expect(r.code).toBe(1)
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('03-prefactor.md: shape:') && /Acceptance criteria/.test(l))).toBe(true)
  for (const l of lines) expect(l.startsWith('03-prefactor.md') || l.startsWith('ticket set')).toBe(true)
  expect(lines.some((l) => l.startsWith('01-') || l.startsWith('02-'))).toBe(false)
})

test('107.3 a missing spec exits 2 and names the spec', () => {
  const p = validFixtureProject()
  const r = check(p, 'tickets', 'map', 'no-such-spec.md')
  expect(r.code).toBe(2)
  expect(r.stdout + r.stderr).toContain('no-such-spec.md')
  expect(r.code).not.toBe(0)
  expect(r.code).not.toBe(1)
})

test('107.4 an uncited decided card gets one set line with the cards-cited check', () => {
  const p = validFixtureProject()
  const log = readFileSync(join(p.dir, '.werk', 'log.jsonl'), 'utf8').trimEnd().split('\n').map((l) => JSON.parse(l))
  const extra = logOf(proposed('map-extra', { status: 'decided', parent: 'map' }), accepted('map-extra')).map((e, i) => ({ ...e, seq: log.length + i + 1 }))
  writeLog(p, [...log, ...extra])
  const r = check(p)
  expect(r.code).toBe(1)
  const about = failureLines(r.stdout).filter((l) => l.includes('map-extra'))
  expect(about).toHaveLength(1)
  expect(about[0]).toMatch(/^ticket set: cards-cited: /)
  expect(about[0]).not.toMatch(/\d\d-[\w-]+\.md/)
})

test('107.5 an undelivered story gets one set line with the stories check', () => {
  const p = validFixtureProject()
  const s = readFileSync(join(p.dir, 'spec.md'), 'utf8').replace(
    '### Later',
    '4. As a person, I want a new numbered story, so that nobody delivers it.\n\n### Later',
  )
  writeFileSync(join(p.dir, 'spec.md'), s)
  const r = check(p)
  expect(r.code).toBe(1)
  const about = failureLines(r.stdout).filter((l) => /\bstory 4\b/.test(l))
  expect(about).toHaveLength(1)
  expect(about[0]).toMatch(/^ticket set: stories: /)
  expect(about[0]).not.toMatch(/\d\d-[\w-]+\.md/)
})

/** A map whose subtree "map" holds the decided cards given, and an open root. */
function mapProject(decided: string[]): Project {
  const p = makeProject()
  writeLog(p, logOf(proposed('map', { status: 'open' }), ...decided.flatMap((id) => [proposed(id, { status: 'decided', parent: 'map' }), accepted(id)])))
  mkdirSync(join(p.dir, 'tickets'))
  return p
}
const put = (p: Project, name: string, text: string) => writeFileSync(join(p.dir, 'tickets', name), text)

function passingSet80(): Project {
  const p = mapProject(['map-reopen', 'map-stale'])
  writeFileSync(join(p.dir, 'spec.md'), spec(3))
  put(p, '01-reopen.md', ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view' }))
  put(p, '02-stale.md', ticket({ title: 'Stale marks', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' }))
  return p
}

test('80.1 a folder of valid tickets passes the ticket check', () => {
  const p = passingSet80()
  const r = check(p)
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
})

test('80.2 missing touches line, a path in the body and a path in touches fail by name', () => {
  const p = passingSet80()
  put(p, '03-more.md', ticket({ title: 'More', cites: 'map-reopen', stories: '1', touches: 'board' }))
  expect(check(p).code).toBe(0)
  put(p, '02-stale.md', ticket({ title: 'Stale marks', cites: 'map-stale', blocked: '1', stories: '3', touches: null }))
  put(p, '03-more.md', ticket({ title: 'More', cites: 'map-reopen', stories: '1', touches: 'board', what: 'A person sees it.\nedit src/loop.ts' }))
  put(p, '01-reopen.md', ticket({ title: 'Reopen a card', cites: 'map-reopen', stories: '1, 2', touches: 'map view, server/routes' }))
  const r = check(p)
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: touches'))).toBe(true)
  const path = lines.find((l) => l.startsWith('03-more.md: no-file-paths:') && l.includes('src/loop.ts'))
  expect(path).toBeDefined()
  expect(path).toMatch(/line \d+/)
  expect(lines.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  const p = mapProject(['map-reopen', 'map-stale'])
  writeFileSync(join(p.dir, 'spec.md'), spec(3))
  put(p, '01-reopen.md', ticket({ title: 'Reopen', cites: 'map-reopen', stories: '1, 2', touches: 'map view' }))
  put(p, '02-stale.md', ticket({ title: 'Stale', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' }))
  put(p, '04-after.md', ticket({ title: 'After', cites: 'map-reopen', blocked: '2', stories: '1', touches: 'board' }))
  expect(check(p).code).toBe(0)
  put(p, '02-stale.md', ticket({ title: 'Stale', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log', noWhatHeading: true }))
  const r = check(p)
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape:') && l.includes('What to build'))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: cards-cited:') && l.includes('map-stale'))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: stories:') && /\bstory 3\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('04-after.md: blocked_by:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  const p = mapProject(['map-reopen', 'map-stale'])
  writeFileSync(join(p.dir, 'spec.md'), spec(4))
  put(p, '01-one.md', ticket({ title: 'One', cites: 'map-stale', stories: '1, 9', touches: 'map view' }))
  put(p, '02-two.md', ticket({ title: 'Two', cites: 'map-stale', blocked: '3', stories: '2', touches: 'board' }))
  put(p, '03-three.md', ticket({ title: 'Three', cites: 'map-stale', blocked: '2', stories: '3', touches: 'chat' }))
  put(p, '04-four.md', ticket({ title: 'Four', cites: 'map-stale', stories: '1', touches: 'fold' }))
  put(p, '05-five.md', ticket({ title: 'Five', cites: 'map-stale', blocked: '8', stories: '2', touches: 'decision log' }))
  const r = check(p)
  const lines = failureLines(r.stdout)
  expect(lines.some((l) => l.includes('cards-cited') && l.includes('map-reopen'))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && /\bstory 4\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.includes('stories') && /\b9\b/.test(l))).toBe(true)
  const blocked = lines.filter((l) => l.includes(': blocked_by: '))
  expect(blocked.some((l) => l.startsWith('02-two.md') && /cycle/.test(l))).toBe(true)
  expect(blocked.some((l) => l.startsWith('03-three.md') && /cycle/.test(l))).toBe(true)
  expect(blocked.some((l) => l.startsWith('05-five.md') && /\b8\b/.test(l))).toBe(true)
  expect(blocked.some((l) => l.startsWith('01-one.md') || l.startsWith('04-four.md'))).toBe(false)
  expect(r.code).not.toBe(0)
})

test('80.5 after the agent adds story 3 to ticket 2 the next ticket check passes', () => {
  const p = mapProject(['map-reopen', 'map-stale'])
  writeFileSync(join(p.dir, 'spec.md'), spec(3))
  put(p, '01-reopen.md', ticket({ title: 'Reopen', cites: 'map-reopen', stories: '1, 2', touches: 'map view' }))
  put(p, '02-stale.md', ticket({ title: 'Stale', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' }))
  const before = check(p)
  expect(before.code).toBe(1)
  expect(failureLines(before.stdout)).toHaveLength(1)
  expect(failureLines(before.stdout)[0]).toMatch(/story 3/)
  const f = join(p.dir, 'tickets', '02-stale.md')
  writeFileSync(f, readFileSync(f, 'utf8').replace('stories: 2', 'stories: 2, 3'))
  const r = check(p)
  expect(failureLines(r.stdout)).toEqual([])
  expect(r.code).toBe(0)
  rmSync(join(p.dir, 'tickets'), { recursive: true })
})
