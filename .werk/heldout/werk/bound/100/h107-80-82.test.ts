/** Held-out steps 107.*, 80.*, 82.2-82.5: the ticket-check verb and the plan verb, run as processes. */
import { expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import type { Event } from '../src/map/events.ts'
import { fold } from '../src/map/fold.ts'
import { readLog } from '../src/map/log.ts'
import type { FakeStep } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

type Ev = Parameters<typeof logOf>[number]

function writeMap(p: Project, events: Ev[]) {
  mkdirSync(join(p.dir, '.werk'), { recursive: true })
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), logOf(...events).map((e) => JSON.stringify(e)).join('\n') + '\n')
}
const mapLog = (p: Project) => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))

type T = { title: string; cites?: string; blocked_by?: string; stories?: string; touches?: string; what?: string }
function ticket(t: T, omit: string[] = []): string {
  const header = [
    ['title', t.title],
    ['cites', t.cites ?? ''],
    ['blocked_by', t.blocked_by ?? ''],
    ['stories', t.stories ?? ''],
    ['touches', t.touches ?? 'map view'],
  ]
    .filter(([k]) => !omit.includes(k!))
    .map(([k, v]) => `${k}: ${v}`)
  const sections = [
    ['What to build', t.what ?? 'A person sees the change on the map.'],
    ['Acceptance criteria', '- [ ] The change shows on the map.'],
    ['Checks', '- `make test`'],
  ]
    .filter(([k]) => !omit.includes(k!))
    .map(([k, v]) => `## ${k}\n\n${v}\n`)
  return header.join('\n') + '\n\n' + sections.join('\n')
}
const spec = (n: number) =>
  `# Spec\n\n## User Stories\n\n${Array.from({ length: n }, (_, i) => `${i + 1}. As a person, I want thing ${i + 1}, so that it works.`).join('\n')}\n`

function writeFolder(p: Project, files: Record<string, string>, folder = 'tickets') {
  rmSync(join(p.dir, folder), { recursive: true, force: true })
  mkdirSync(join(p.dir, folder), { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, folder, name), text)
}
const check = (p: Project, root = 'map') => p.werk(['ticket-check', 'tickets', '--root', root, '--spec', 'spec.md'])
const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr
const failLines = (r: { stdout: string }) => r.stdout.split('\n').filter((l) => l && !l.startsWith('ticket-check:'))

// ---------- 107 ----------
/** A project with a decided subtree "map" (root open) whose decided cards are a and b, and a valid set. */
function validSet(): Project {
  const p = makeProject()
  writeMap(p, [
    proposed('map', { status: 'open' }),
    proposed('map-a', { status: 'decided', parent: 'map' }),
    proposed('map-b', { status: 'decided', parent: 'map' }),
    accepted('map'),
    accepted('map-a'),
    accepted('map-b'),
  ])
  writeFileSync(join(p.dir, 'spec.md'), spec(2))
  writeFolder(p, {
    '01-a.md': ticket({ title: 'Ticket a', cites: 'map-a', stories: '1' }),
    '02-b.md': ticket({ title: 'Ticket b', cites: 'map-b', stories: '2', touches: 'decision log' }),
    '03-c.md': ticket({ title: 'Ticket c', cites: 'map-a', stories: '1', touches: 'board' }),
  })
  return p
}

test('107.1 A valid ticket set passes the ticket check', () => {
  // Given a project with a decided subtree whose decided cards each appear in the cites of at least one ticket
  // And a spec whose every story number appears in the stories of at least one ticket
  // And a folder of tickets that each have all five header lines and all three sections
  const p = validSet()
  // When the person runs the ticket-check verb on the folder, the spec and the subtree root
  const r = check(p)
  // Then the command exits with code 0 / And the output reports no failure
  expect(r.code).toBe(0)
  expect(failLines(r)).toEqual([])
  expect(r.stdout).toContain('0 failure(s)')
})

test('107.2 A ticket that fails its shape check makes the run fail', () => {
  const p = validSet()
  // And one ticket in the folder has no "## Acceptance criteria" heading
  writeFileSync(join(p.dir, 'tickets', '03-c.md'), ticket({ title: 'Ticket c', cites: 'map-a', stories: '1', touches: 'board' }, ['Acceptance criteria']))
  const r = check(p)
  expect(r.code).toBe(1)
  const lines = failLines(r)
  expect(lines.some((l) => l.startsWith('03-c.md: shape:') && l.includes('## Acceptance criteria'))).toBe(true)
  // But the output names no other ticket as failed
  expect(lines.filter((l) => !l.startsWith('03-c.md'))).toEqual([])
})

test('107.3 A call with a missing spec cannot run the checks and says so', () => {
  const p = validSet()
  const r = p.werk(['ticket-check', 'tickets', '--root', 'map', '--spec', 'no-such-spec.md'])
  expect(r.code).toBe(2)
  expect(out(r)).toContain('no-such-spec.md')
  expect([0, 1]).not.toContain(r.code)
})

test('107.4 An uncited decided card is reported against the ticket set', () => {
  const p = validSet()
  // And the person adds a new decided card under that subtree that no ticket cites
  const extra = logOf(proposed('map-new', { status: 'decided', parent: 'map' }), accepted('map-new'))
  const n = mapLog(p).length
  writeFileSync(
    join(p.dir, '.werk', 'log.jsonl'),
    readFileSync(join(p.dir, '.werk', 'log.jsonl'), 'utf8') + extra.map((e) => JSON.stringify({ ...e, seq: e.seq + n })).join('\n') + '\n',
  )
  const r = check(p)
  expect(r.code).toBe(1)
  const about = failLines(r).filter((l) => l.includes('map-new'))
  expect(about).toHaveLength(1)
  expect(about[0]!).toMatch(/^ticket set: cards-cited: /)
  expect(about[0]!).not.toMatch(/^\d\d-/)
  expect(about[0]!).not.toMatch(/\.md/)
})

test('107.5 An undelivered story is reported against the ticket set', () => {
  const p = validSet()
  writeFileSync(join(p.dir, 'spec.md'), spec(3))
  const r = check(p)
  expect(r.code).toBe(1)
  const about = failLines(r).filter((l) => /story 3\b/.test(l))
  expect(about).toHaveLength(1)
  expect(about[0]!).toMatch(/^ticket set: stories: /)
  expect(about[0]!).not.toMatch(/\.md/)
})

// ---------- 80 ----------
function subtree80(p: Project) {
  writeMap(p, [
    proposed('map', { status: 'open' }),
    proposed('map-reopen', { status: 'decided', parent: 'map' }),
    proposed('map-stale', { status: 'decided', parent: 'map' }),
    accepted('map'),
    accepted('map-reopen'),
    accepted('map-stale'),
  ])
}

test('80.1 A folder of valid tickets passes the ticket check', () => {
  const p = makeProject()
  subtree80(p)
  writeFileSync(join(p.dir, 'spec.md'), spec(3))
  writeFolder(p, {
    '01-reopen.md': ticket({ title: 'Reopen', cites: 'map-reopen', stories: '1, 2', touches: 'map view' }),
    '02-stale.md': ticket({ title: 'Stale', cites: 'map-stale', blocked_by: '1', stories: '3', touches: 'decision log' }),
  })
  const r = check(p)
  expect(failLines(r)).toEqual([])
  expect(r.code).toBe(0)
})

function passing80(p: Project) {
  subtree80(p)
  writeFileSync(join(p.dir, 'spec.md'), spec(3))
  const t1 = { title: 'Reopen', cites: 'map-reopen', stories: '1', touches: 'map view' }
  const t2 = { title: 'Stale', cites: 'map-stale', blocked_by: '1', stories: '2', touches: 'decision log' }
  const t3 = { title: 'Third', cites: 'map-reopen', stories: '3', touches: 'board' }
  writeFolder(p, { '01-reopen.md': ticket(t1), '02-stale.md': ticket(t2), '03-third.md': ticket(t3) })
  expect(check(p).code).toBe(0)
  return { t1, t2, t3 }
}

test('80.2 A ticket with a missing touches line and a path in its body fails its own checks by name', () => {
  const p = makeProject()
  const { t1, t2, t3 } = passing80(p)
  // When the person deletes the touches line from ticket 2
  writeFileSync(join(p.dir, 'tickets', '02-stale.md'), ticket(t2, ['touches']))
  // And the person adds the text "edit src/loop.ts" to the What to build section of ticket 3
  const t3text = ticket(t3).replace('A person sees the change on the map.', 'A person sees the change on the map.\nedit src/loop.ts')
  writeFileSync(join(p.dir, 'tickets', '03-third.md'), t3text)
  const pathLine = t3text.split('\n').findIndex((l) => l.includes('edit src/loop.ts')) + 1
  // And the person changes the touches line of ticket 1 to "map view, server/routes"
  writeFileSync(join(p.dir, 'tickets', '01-reopen.md'), ticket({ ...t1, touches: 'map view, server/routes' }))
  const r = check(p)
  const lines = failLines(r)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape: touches'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-third.md: no-file-paths:') && l.includes('src/loop.ts') && l.includes(`line ${pathLine}`))).toBe(true)
  expect(lines.some((l) => l.startsWith('01-reopen.md: touches:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.3 A ticket that fails its own checks does not count in the set checks', () => {
  const p = makeProject()
  subtree80(p)
  writeFileSync(join(p.dir, 'spec.md'), spec(3))
  const t2 = { title: 'Stale', cites: 'map-stale', stories: '3', touches: 'decision log' }
  writeFolder(p, {
    '01-reopen.md': ticket({ title: 'Reopen', cites: 'map-reopen', stories: '1, 2', touches: 'map view' }),
    '02-stale.md': ticket(t2),
    '04-after.md': ticket({ title: 'After', cites: 'map-reopen', blocked_by: '2', stories: '1', touches: 'board' }),
  })
  expect(check(p).code).toBe(0)
  // When the person removes the What to build heading from ticket 2
  writeFileSync(join(p.dir, 'tickets', '02-stale.md'), ticket(t2).replace('## What to build\n', ''))
  const r = check(p)
  const lines = failLines(r)
  expect(lines.some((l) => l.startsWith('02-stale.md: shape:') && l.includes('What to build'))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: cards-cited:') && l.includes('map-stale'))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: stories:') && /story 3\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('04-after.md: blocked_by:'))).toBe(true)
  expect(r.code).not.toBe(0)
})

test('80.4 A ticket set with coverage and order errors names each card, story and ticket', () => {
  const p = makeProject()
  subtree80(p)
  writeFileSync(join(p.dir, 'spec.md'), spec(4))
  writeFolder(p, {
    '01-one.md': ticket({ title: 'One', cites: 'map-stale', stories: '1, 9', touches: 'map view' }),
    '02-two.md': ticket({ title: 'Two', cites: 'map-stale', blocked_by: '3', stories: '2', touches: 'decision log' }),
    '03-three.md': ticket({ title: 'Three', cites: 'map-stale', blocked_by: '2', stories: '3', touches: 'board' }),
    '04-four.md': ticket({ title: 'Four', cites: 'map-stale', blocked_by: '1', stories: '1', touches: 'board' }),
    '05-five.md': ticket({ title: 'Five', cites: 'map-stale', blocked_by: '8', stories: '2', touches: 'board' }),
  })
  const r = check(p)
  const lines = failLines(r)
  expect(lines.some((l) => l.startsWith('ticket set: cards-cited:') && l.includes('map-reopen'))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: stories:') && /story 4\b/.test(l) && l.includes('no ticket delivers'))).toBe(true)
  expect(lines.some((l) => l.startsWith('ticket set: stories:') && /story 9\b/.test(l))).toBe(true)
  expect(lines.some((l) => l.startsWith('02-two.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('03-three.md: blocked_by:') && l.includes('cycle'))).toBe(true)
  expect(lines.some((l) => l.startsWith('05-five.md: blocked_by:') && l.includes('8'))).toBe(true)
  expect(lines.filter((l) => /^0[14]-\w+\.md: blocked_by:/.test(l))).toEqual([])
  expect(r.code).not.toBe(0)
})

test('80.5 An agent fixes a ticket on request and the next ticket check passes', () => {
  const p = makeProject()
  subtree80(p)
  writeFileSync(join(p.dir, 'spec.md'), spec(3))
  const t2 = { title: 'Stale', cites: 'map-stale', blocked_by: '1', stories: '2', touches: 'decision log' }
  writeFolder(p, {
    '01-reopen.md': ticket({ title: 'Reopen', cites: 'map-reopen', stories: '1', touches: 'map view' }),
    '02-stale.md': ticket(t2),
  })
  const before = check(p)
  expect(failLines(before)).toHaveLength(1)
  expect(failLines(before)[0]!).toContain('story 3')
  // When an agent changes ticket 2 to list story 3, on the person's request
  writeFileSync(join(p.dir, 'tickets', '02-stale.md'), ticket({ ...t2, stories: '2, 3' }))
  const r = check(p)
  expect(failLines(r)).toEqual([])
  expect(r.code).toBe(0)
})

// ---------- 82 ----------
const PLAN = '.werk/plans/auth'
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })
type Answer = { slug: string; title: string; why: string; body: string }

function authProject(extra: Ev[] = []): Project {
  const p = makeProject()
  writeMap(p, [
    proposed('auth', { status: 'decided', who: 'you' }),
    proposed('auth-session', { status: 'decided', parent: 'auth' }),
    accepted('auth-session'),
    ...extra,
  ])
  return p
}
function writers(p: Project, tickets: Record<string, string>, answers: { spec?: Answer[]; tickets?: Answer[] } = {}, stories = 1) {
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, spec(stories)), edit(`${PLAN}/spec.answers.json`, JSON.stringify(answers.spec ?? []))] },
      'ticket-writer': {
        steps: [
          ...Object.entries(tickets).map(([name, text]) => edit(`${PLAN}/tickets/${name}`, text)),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify(answers.tickets ?? [])),
        ],
      },
    },
  })
}
const board = (p: Project) => foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
const titlesIn = (p: Project, col: string) => board(p).columns.find((c) => c.name === col)!.tickets.map((t) => t.title)
const allTitles = (p: Project) => board(p).columns.flatMap((c) => c.tickets.map((t) => t.title))

test('82.2 A plan stops with an error when an answer record has an id that is already in the map', () => {
  const p = authProject([proposed('auth-token-ttl', { status: 'open', parent: 'auth' }), accepted('auth-token-ttl')])
  writers(p, { '01-login.md': ticket({ title: 'login', cites: 'auth, auth-session', stories: '1' }) }, {
    spec: [{ slug: 'token-ttl', title: 'Token TTL', why: 'How long?', body: 'One hour.' }],
  })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(out(r)).toContain('token-ttl')
  const ids = mapLog(p).filter((e) => e.type === 'node.proposed' && (e.payload as { id: string }).id === 'auth-token-ttl')
  expect(ids).toHaveLength(1)
})

test('82.3 A ticket that fails its own checks stays off the board and gives no coverage', () => {
  const p = authProject()
  writers(p, {
    '01-login.md': ticket({ title: 'login', cites: 'auth-session', stories: '1' }, ['stories']),
    '02-logout.md': ticket({ title: 'logout', cites: 'auth', stories: '1', touches: 'board' }),
  })
  const r = p.werk(['plan', 'auth'])
  expect(allTitles(p)).toContain('logout')
  expect(allTitles(p)).not.toContain('login')
  expect(r.stdout).toMatch(/01-login\.md: shape: stories/)
  expect(r.stdout).toMatch(/ticket set: cards-cited: .*#auth-session/)
})

test('82.4 A ticket that names a failed ticket as a blocker is blocked, and its correct blockers go to ready', () => {
  const p = authProject()
  writers(p, {
    '01-a.md': ticket({ title: 'a', cites: 'auth', stories: '1' }, ['touches']),
    '02-b.md': ticket({ title: 'b', cites: 'auth, auth-session', stories: '1', touches: 'board' }),
    '03-c.md': ticket({ title: 'c', cites: 'auth', blocked_by: '1, 2', stories: '1', touches: 'decision log' }),
  })
  p.werk(['plan', 'auth'])
  expect(allTitles(p)).not.toContain('a')
  expect(titlesIn(p, 'blocked')).toContain('c')
  expect(titlesIn(p, 'ready')).toContain('b')
})

test('82.5 A second plan archives an open ticket that the new spec drops, and a restore puts it back', () => {
  const p = authProject()
  const login = ticket({ title: 'login', cites: 'auth, auth-session', stories: '1' })
  const logout = ticket({ title: 'logout', cites: 'auth', stories: '1', touches: 'board' })
  writers(p, { '01-login.md': login, '02-logout.md': logout })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(titlesIn(p, 'ready')).toEqual(['login', 'logout'])
  // And the ticket writer now returns only the ticket "login"
  writers(p, { '01-login.md': login })
  p.werk(['plan', 'auth'])
  const archived = readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')).filter((e) => e.type === 'ticket.archived')
  expect(archived).toHaveLength(1)
  expect(archived[0]!.payload).toMatchObject({ number: 2 })
  expect((archived[0]!.payload as { reason: string }).reason).toMatch(/current spec .*no longer needs it/)
  expect(titlesIn(p, 'ready')).toContain('login')
  expect(allTitles(p)).not.toContain('logout')
  // When the person restores "logout"
  expect(p.werk(['ticket', 'restore', '2', '--actor', 'you']).code).toBe(0)
  expect(titlesIn(p, 'ready')).toContain('logout')
})
