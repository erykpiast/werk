/** Held-out steps 80.1-80.5: the ticket check on a folder. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

/** A map whose subtree under the open root "map" holds the given decided cards. */
function project(decided: string[]): Project {
  p = makeProject()
  const log = logOf(
    proposed('map', { status: 'open' }),
    accepted('map'),
    ...decided.flatMap((id) => [proposed(id, { status: 'decided', parent: 'map' }), accepted(id)]),
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  mkdirSync(join(p.dir, 'tickets'))
  return p
}

function spec(n: number) {
  const stories = Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}, so that it works.`)
  writeFileSync(join(p.dir, 'spec.md'), `# Spec\n\n## User Stories\n\n${stories.join('\n')}\n`)
}

type T = { title: string; cites: string; blocked_by: string; stories: string; touches: string }
const text = (t: T) =>
  `title: ${t.title}\ncites: ${t.cites}\nblocked_by: ${t.blocked_by}\nstories: ${t.stories}\ntouches: ${t.touches}\n\n` +
  `## What to build\n\nThe person sees the thing work.\n\n## Acceptance criteria\n\n- [ ] The thing works.\n\n## Checks\n\n- \`make test\`\n`
const file = (name: string) => join(p.dir, 'tickets', name)
const write = (name: string, t: T) => writeFileSync(file(name), text(t))
const check = () => p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'spec.md'])

test('80.1 a folder of valid tickets passes the ticket check', () => {
  project(['map-reopen', 'map-stale'])
  spec(3)
  write('01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', blocked_by: '', stories: '1, 2', touches: 'map view' })
  write('02-stale.md', { title: 'Mark stale cards', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' })
  const r = check()
  console.log('80.1', JSON.stringify(r))
  expect(r.stdout).not.toMatch(/^(?!ticket-check:).+: .+: /m)
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.code).toBe(0)
})

test('80.2 a missing touches line and a path in the body fail their own checks by name', () => {
  project(['map-reopen', 'map-stale', 'map-loop'])
  spec(3)
  write('01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', blocked_by: '', stories: '1', touches: 'map view' })
  write('02-stale.md', { title: 'Mark stale cards', cites: 'map-stale', blocked_by: '1', stories: '2', touches: 'decision log' })
  write('03-loop.md', { title: 'Loop the build', cites: 'map-loop', blocked_by: '', stories: '3', touches: 'builder loop' })
  expect(check().code).toBe(0)

  writeFileSync(file('02-stale.md'), readFileSync(file('02-stale.md'), 'utf8').replace(/^touches:.*\n/m, ''))
  const t3 = readFileSync(file('03-loop.md'), 'utf8').replace(
    'The person sees the thing work.\n',
    'The person sees the thing work.\nedit src/loop.ts\n',
  )
  writeFileSync(file('03-loop.md'), t3)
  const line = t3.split('\n').indexOf('edit src/loop.ts') + 1
  writeFileSync(file('01-reopen.md'), readFileSync(file('01-reopen.md'), 'utf8').replace(/^touches:.*$/m, 'touches: map view, server/routes'))

  const r = check()
  console.log('80.2', r.stdout)
  expect(r.stdout).toMatch(/^02-stale\.md: shape: touches: /m)
  expect(r.stdout).toMatch(new RegExp(`^03-loop\\.md: no-file-paths: .*line ${line}\\b.*src/loop\\.ts`, 'm'))
  expect(r.stdout).toMatch(/^01-reopen\.md: touches: /m)
  expect(r.code).not.toBe(0)
})

test('80.3 a ticket that fails its own checks does not count in the set checks', () => {
  project(['map-reopen', 'map-stale'])
  spec(3)
  write('01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', blocked_by: '', stories: '1', touches: 'map view' })
  write('02-stale.md', { title: 'Mark stale cards', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' })
  write('03-more.md', { title: 'More reopen', cites: 'map-reopen', blocked_by: '', stories: '2', touches: 'map view' })
  write('04-after.md', { title: 'After the stale marks', cites: 'map-reopen', blocked_by: '2', stories: '2', touches: 'map view' })
  expect(check().code).toBe(0)

  writeFileSync(file('02-stale.md'), readFileSync(file('02-stale.md'), 'utf8').replace('## What to build\n', ''))
  const r = check()
  console.log('80.3', r.stdout)
  expect(r.stdout).toMatch(/^02-stale\.md: shape: What to build: .*"## What to build" is missing/m)
  expect(r.stdout).toMatch(/cards-cited: .*#map-stale/)
  expect(r.stdout).toMatch(/stories: .*no ticket delivers story 3/)
  expect(r.stdout).toMatch(/^04-after\.md: blocked_by: .*blocker 2 is not a ticket in the set/m)
  expect(r.code).not.toBe(0)
})

test('80.4 coverage and order errors name each card, story and ticket', () => {
  project(['map-reopen', 'map-stale'])
  spec(4)
  write('01-one.md', { title: 'One', cites: 'map-stale', blocked_by: '', stories: '1, 9', touches: 'map view' })
  write('02-two.md', { title: 'Two', cites: 'map-stale', blocked_by: '3', stories: '2', touches: 'map view' })
  write('03-three.md', { title: 'Three', cites: 'map-stale', blocked_by: '2', stories: '3', touches: 'map view' })
  write('04-four.md', { title: 'Four', cites: 'map-stale', blocked_by: '', stories: '1', touches: 'map view' })
  write('05-five.md', { title: 'Five', cites: 'map-stale', blocked_by: '8', stories: '2', touches: 'map view' })
  const r = check()
  console.log('80.4', r.stdout)
  expect(r.stdout).toMatch(/cards-cited: .*#map-reopen/)
  expect(r.stdout).toMatch(/stories: .*no ticket delivers story 4/)
  expect(r.stdout).toMatch(/stories: .*story 9 .*no story 9/)
  expect(r.stdout).toMatch(/^02-two\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^03-three\.md: blocked_by: .*cycle/m)
  expect(r.stdout).toMatch(/^05-five\.md: blocked_by: .*blocker 8/m)
  expect(r.stdout).not.toMatch(/^01-one\.md: blocked_by/m)
  expect(r.stdout).not.toMatch(/^04-four\.md: blocked_by/m)
  expect(r.code).not.toBe(0)
})

test('80.5 an agent fixes a ticket on request and the next check passes', () => {
  project(['map-reopen', 'map-stale'])
  spec(3)
  write('01-reopen.md', { title: 'Reopen a card', cites: 'map-reopen', blocked_by: '', stories: '1, 2', touches: 'map view' })
  write('02-stale.md', { title: 'Mark stale cards', cites: 'map-stale', blocked_by: '1', stories: '', touches: 'decision log' })
  const before = check()
  console.log('80.5 before', before.stdout)
  const failures = before.stdout.split('\n').filter((l) => /^.+?: .+?: .+?: /.test(l) && !l.startsWith('ticket-check:'))
  expect(failures).toEqual(['ticket set: stories: stories: no ticket delivers story 3'])
  expect(before.code).not.toBe(0)

  // The agent's edit: ticket 2 now lists story 3.
  writeFileSync(file('02-stale.md'), readFileSync(file('02-stale.md'), 'utf8').replace(/^stories:.*$/m, 'stories: 3'))
  const r = check()
  console.log('80.5 after', r.stdout)
  expect(r.stdout).toContain('0 failure(s)')
  expect(r.code).toBe(0)
})
