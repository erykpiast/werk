/** Held-out steps 82.2 - 82.5: the plan verb over the decided subtree "#auth". */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { Event } from '../../src/map/events.ts'
import { fold } from '../../src/map/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

const SPEC = readFileSync(join(import.meta.dir, '..', '..', 'src', 'test', 'fixtures', 'tickets', 'spec.md'), 'utf8')
const PLAN = '.werk/plans/auth'

let p: Project
afterEach(() => p?.cleanup())

function project(extra: Parameters<typeof logOf> = []): Project {
  p = makeProject()
  const log = logOf(
    proposed('auth', { status: 'decided', who: 'you' }),
    proposed('auth-session', { status: 'decided', parent: 'auth' }),
    proposed('auth-login', { status: 'decided', parent: 'auth' }),
    accepted('auth-session'),
    accepted('auth-login'),
    ...extra,
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return p
}

type T = { title: string; cites: string; blockedBy?: string; stories: string; touches?: string | null }
const ticket = ({ title, cites, blockedBy = '', stories, touches = 'session store' }: T) =>
  [
    `title: ${title}`,
    `cites: ${cites}`,
    `blocked_by: ${blockedBy}`,
    `stories: ${stories}`,
    ...(touches === null ? [] : [`touches: ${touches}`]),
    '',
    '## What to build',
    '',
    `${title}.`,
    '',
    '## Acceptance criteria',
    '',
    `- [ ] ${title} works.`,
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

type Answer = { slug: string; title: string; why: string; body: string }
const answer = (slug: string): Answer => ({ slug, title: `Answer ${slug}`, why: `Which ${slug}?`, body: `The ${slug} body.` })
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })

function writers(tickets: Record<string, string>, answers: { spec?: Answer[]; tickets?: Answer[] } = {}) {
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify(answers.spec ?? []))] },
      'ticket-writer': {
        steps: [
          ...Object.entries(tickets).map(([name, text]) => edit(`${PLAN}/tickets/${name}`, text)),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify(answers.tickets ?? [])),
        ],
      },
    },
  })
}

const mapLog = () => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))
const boardLog = () => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
const board = () => foldBoard(boardLog())
const titlesIn = (name: string) => board().columns.find((c) => c.name === name)?.tickets.map((t) => t.title) ?? []
const allTitles = () => board().columns.flatMap((c) => c.tickets.map((t) => t.title))

test('82.2 A plan stops with an error when an answer record has an id that is already in the map', () => {
  project([proposed('auth-token-ttl', { parent: 'auth' }), accepted('auth-token-ttl')])
  const countBefore = mapLog().filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl').length
  writers(
    {
      '01-login.md': ticket({ title: 'Login', cites: 'auth-session, auth-login, auth-token-ttl', stories: '1, 2, 3' }),
    },
    { spec: [answer('token-ttl')] },
  )
  const r = p.werk(['plan', 'auth'])
  // Then the plan exits with an error
  expect(r.code).not.toBe(0)
  // And the output names the record "token-ttl"
  expect(r.stdout + r.stderr).toContain('token-ttl')
  // And the map shows no second card with the id "#auth-token-ttl"
  const countAfter = mapLog().filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl').length
  expect(countAfter).toBe(countBefore)
  expect([...fold(mapLog()).nodes.keys()].filter((id) => id === 'auth-token-ttl')).toHaveLength(1)
})

test('82.3 A ticket that fails its own checks stays off the board and gives no coverage', () => {
  project()
  writers({
    '01-login.md': [
      'title: login',
      'cites: auth-session',
      'blocked_by:',
      'touches: session store',
      '',
      '## What to build',
      '',
      'Login.',
      '',
      '## Acceptance criteria',
      '',
      '- [ ] Login works.',
      '',
      '## Checks',
      '',
      '- `make test`',
      '',
    ].join('\n'),
    '02-logout.md': ticket({ title: 'logout', cites: 'auth-login, auth', stories: '1, 2, 3' }),
  })
  const r = p.werk(['plan', 'auth'])
  const out = r.stdout + r.stderr
  // Then the board shows "logout" and does not show "login"
  expect(allTitles()).toContain('logout')
  expect(allTitles()).not.toContain('login')
  // And the output names the missing field in "login"
  expect(out).toMatch(/01-login\.md.*stories/)
  // And the output reports "#auth-session" as a card that no ticket cites
  expect(out).toMatch(/no ticket cites the decided card #auth-session/)
})

test('82.4 A ticket that names a failed ticket as a blocker is blocked, and its correct blockers go to ready', () => {
  project()
  writers({
    '01-a.md': ticket({ title: 'a', cites: 'auth', stories: '1', touches: null }),
    '02-b.md': ticket({ title: 'b', cites: 'auth, auth-session, auth-login', stories: '1, 2', touches: 'module b' }),
    '03-c.md': ticket({ title: 'c', cites: 'auth-session', blockedBy: '1, 2', stories: '3', touches: 'module c' }),
  })
  const r = p.werk(['plan', 'auth'])
  // Then the board does not show "a"
  expect(allTitles()).not.toContain('a')
  // And the board shows "c" as blocked
  expect(titlesIn('blocked')).toContain('c')
  // And the board shows "b" as ready
  expect(titlesIn('ready')).toContain('b')
  expect(r.stdout).toBeTruthy()
})

test('82.5 A second plan archives an open ticket that the new spec drops, and a restore puts it back', () => {
  project()
  const login = ticket({ title: 'login', cites: 'auth, auth-session, auth-login', stories: '1, 2, 3', touches: 'login form' })
  const logout = ticket({ title: 'logout', cites: 'auth-session', stories: '3', touches: 'logout button' })
  writers({ '01-login.md': login, '02-logout.md': logout })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  const open = () => [...titlesIn('ready'), ...titlesIn('blocked')]
  // Given the board shows the open tickets "login" and "logout"
  expect(open()).toEqual(expect.arrayContaining(['login', 'logout']))

  writers({ '01-login.md': login })
  p.werk(['plan', 'auth'])
  const logoutNumber = boardLog().find((e) => e.type === 'ticket.planned' && e.payload.title === 'logout')!.payload as { number: number }
  // Then the board log shows "logout" as archived with the reason that the current spec no longer needs it
  const archived = boardLog().find((e) => e.type === 'ticket.archived' && (e.payload as { number: number }).number === logoutNumber.number)
  expect(archived).toBeDefined()
  expect((archived!.payload as { reason: string }).reason).toMatch(/current spec .*no longer needs it/)
  // And the board shows "login" as open
  expect(open()).toContain('login')
  expect(open()).not.toContain('logout')

  // When the person restores "logout"
  const r = p.werk(['ticket', 'restore', String(logoutNumber.number)])
  expect(r.code).toBe(0)
  // Then the board shows "logout" as open again
  expect(open()).toContain('logout')
})
