/** Held-out steps 80.1–80.5: the ticket check, run as a process. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

function project(spec: number[]): Project {
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
  mkdirSync(join(p.dir, 'tickets'))
  const stories = spec.map((n) => `${n}. As a person, I want thing ${n}, so that it works.`).join('\n')
  writeFileSync(join(p.dir, 'spec.md'), `# Spec\n\n## User Stories\n\n${stories}\n\n## Implementation Decisions\n\n1. Not a story.\n`)
  return p
}

type T = { title: string; cites?: string; blocked?: string; stories?: string; touches?: string | null; what?: string; noWhat?: boolean }
function ticket(file: string, t: T) {
  const lines = [
    `title: ${t.title}`,
    `cites: ${t.cites ?? ''}`,
    `blocked_by: ${t.blocked ?? ''}`,
    `stories: ${t.stories ?? ''}`,
    ...(t.touches === null ? [] : [`touches: ${t.touches ?? 'map view'}`]),
    '',
    ...(t.noWhat ? [] : ['## What to build', '', t.what ?? `Build ${t.title}.`, '']),
    '## Acceptance criteria',
    '',
    '- [ ] It works.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ]
  writeFileSync(join(p.dir, 'tickets', file), lines.join('\n'))
}
const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])
const fileOf = (name: string) => join(p.dir, 'tickets', name)

test('80.1 a folder of valid tickets passes the ticket check', () => {
  project([1, 2, 3])
  ticket('01-reopen.md', { title: 'Reopen', cites: 'map-reopen', stories: '1, 2', touches: 'map view' })
  ticket('02-stale.md', { title: 'Stale', cites: 'map-stale', blocked: '1', stories: '3', touches: 'decision log' })
  const r = check()
  console.log(r.stdout, r.stderr)
  expect(r.stdout).not.toMatch(/^(?!ticket-check:).*: /m)
  expect(r.stdout).toContain('0 failure(s) in all')
  expect(r.code).toBe(0)
})

function passingSet() {
  project([1, 2, 3])
  ticket('01-reopen.md', { title: 'Reopen', cites: 'map-reopen', stories: '1', touches: 'map view' })
  ticket('02-stale.md', { title: 'Stale', cites: 'map-stale', blocked: '1', stories: '2', touches: 'decision log' })
  ticket('03-more.md', { title: 'More', stories: '3', touches: 'stale marks' })
  expect(check().code).toBe(0)
}

test('80.2 a missing touches line and a path in the body fail by name', () => {
  passingSet()
  writeFileSync(fileOf('02-stale.md'), readFileSync(fileOf('02-stale.md'), 'utf8').replace(/^touches:.*\n/m, ''))
  writeFileSync(fileOf('03-more.md'), readFileSync(fileOf('03-more.md'), 'utf8').replace('Build More.', 'Build More.\nedit src/loop.ts'))
  writeFileSync(fileOf('01-reopen.md'), readFileSync(fileOf('01-reopen.md'), 'utf8').replace(/^touches:.*$/m, 'touches: map view, server/routes'))
  const r = check()
  console.log(r.stdout)
  expect(r.stdout).toMatch(/^02-stale\.md: shape: touches: /m)
  expect(r.stdout).toMatch(/^03-more\.md: no-file-paths: What to build: line \d+ names the file path "src\/loop\.ts"/m)
  expect(r.stdout).toMatch(/^01-reopen\.md: touches: /m)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  project([1, 2, 3])
  ticket('01-reopen.md', { title: 'Reopen', cites: 'map-reopen', stories: '1, 2' })
  ticket('02-stale.md', { title: 'Stale', cites: 'map-stale', stories: '3' })
  ticket('04-after.md', { title: 'After', blocked: '2' })
  expect(check().code).toBe(0)
  writeFileSync(fileOf('02-stale.md'), readFileSync(fileOf('02-stale.md'), 'utf8').replace('## What to build\n', ''))
  const r = check()
  console.log(r.stdout)
  expect(r.stdout).toMatch(/^02-stale\.md: shape: What to build: .*missing/m)
  expect(r.stdout).toContain('no ticket cites the decided card #map-stale')
  expect(r.stdout).toContain('no ticket delivers story 3')
  expect(r.stdout).toMatch(/^04-after\.md: blocked_by: .*blocker 2 is not a ticket in the set/m)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  project([1, 2, 3, 4])
  ticket('01-a.md', { title: 'A', cites: 'map-stale', stories: '1, 9' })
  ticket('02-b.md', { title: 'B', blocked: '3', stories: '2' })
  ticket('03-c.md', { title: 'C', blocked: '2', stories: '3' })
  ticket('04-d.md', { title: 'D', blocked: '1' })
  ticket('05-e.md', { title: 'E', blocked: '8' })
  const r = check()
  console.log(r.stdout)
  expect(r.stdout).toContain('no ticket cites the decided card #map-reopen')
  expect(r.stdout).toContain('no ticket delivers story 4')
  expect(r.stdout).toMatch(/story 9 .*no story 9/)
  expect(r.stdout).toMatch(/^02-b\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^03-c\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^05-e\.md: blocked_by: .*blocker 8/m)
  expect(r.stdout).not.toMatch(/^01-a\.md: blocked_by/m)
  expect(r.stdout).not.toMatch(/^04-d\.md: blocked_by/m)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next check passes', () => {
  project([1, 2, 3])
  ticket('01-reopen.md', { title: 'Reopen', cites: 'map-reopen', stories: '1' })
  ticket('02-stale.md', { title: 'Stale', cites: 'map-stale', blocked: '1', stories: '2' })
  const first = check()
  expect(first.code).not.toBe(0)
  const failLines = first.stdout.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check:'))
  expect(failLines).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  // The agent edits ticket 2 to list story 3, as a scripted agent edit.
  p.scriptAgent({ steps: [{ edit: { path: 'tickets/02-stale.md', content: readFileSync(fileOf('02-stale.md'), 'utf8').replace('stories: 2', 'stories: 2, 3') } }] })
  expect(p.run(['claude', '-p', 'list story 3 in ticket 2']).code).toBe(0)
  const r = check()
  console.log(r.stdout)
  expect(r.stdout.split('\n').filter((l) => l !== '' && !l.startsWith('ticket-check:'))).toEqual([])
  expect(r.code).toBe(0)
})
