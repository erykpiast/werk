/** Held-out steps 82.2–82.5: the plan verb with fake writers. The board is read as the fold of .werk/board.jsonl. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { Event } from '../../src/map/events.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

let p: Project
afterEach(() => p?.cleanup())

const PLAN = '.werk/plans/auth'
const SPEC = ['# Spec', '', '## User Stories', '', '1. As a person, I log in, so that I see my map.', '2. As a person, I log out, so that I leave.', ''].join('\n')

function project(extra: Parameters<typeof logOf> = []): Project {
  p = makeProject()
  const log = logOf(
    proposed('auth', { status: 'decided', who: 'you' }),
    accepted('auth'),
    proposed('auth-session', { status: 'decided', parent: 'auth' }),
    accepted('auth-session'),
    proposed('auth-login', { status: 'decided', parent: 'auth' }),
    accepted('auth-login'),
    ...extra,
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return p
}

type T = { title: string; cites: string; blocked?: string; stories?: string | null; touches?: string | null }
const ticket = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    ...(t.stories === null ? [] : [`stories: ${t.stories ?? '1'}`]),
    ...(t.touches === null ? [] : [`touches: ${t.touches ?? 'session'}`]),
    '',
    '## What to build',
    '',
    `A person can ${t.title.toLowerCase()}.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] It works in the map.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })
type Answer = { slug: string; title: string; why: string; body: string }
function writers(tickets: Record<string, string>, specAnswers: Answer[] = [], ticketAnswers: Answer[] = []) {
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify(specAnswers))] },
      'ticket-writer': {
        steps: [
          ...Object.entries(tickets).map(([n, text]) => edit(`${PLAN}/tickets/${n}`, text)),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify(ticketAnswers)),
        ],
      },
    },
  })
}
const mapLog = () => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))
const boardLog = () => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
const board = () => foldBoard(boardLog())
const columnOf = (title: string) => board().columns.find((c) => c.tickets.some((t) => t.title === title))?.name

test('82.2 a plan stops with an error when an answer record has an id already in the map', () => {
  project([proposed('auth-token-ttl', { status: 'open', parent: 'auth' }), accepted('auth-token-ttl')])
  writers(
    { '01-login.md': ticket({ title: 'Log in', cites: 'auth, auth-session, auth-login', stories: '1, 2' }) },
    [{ slug: 'token-ttl', title: 'Token TTL', why: 'How long does a token live?', body: 'One hour.' }],
  )
  const r = p.werk(['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const proposals = mapLog().filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl')
  expect(proposals).toHaveLength(1)
  const show = p.werk(['show', 'auth-token-ttl'])
  expect(show.stdout).toContain('state: real')
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  project()
  writers({
    '01-login.md': ticket({ title: 'Log in', cites: 'auth-session', stories: null }),
    '02-logout.md': ticket({ title: 'Log out', cites: 'auth, auth-login', stories: '1, 2' }),
  })
  const r = p.werk(['plan', 'auth'])
  expect(columnOf('Log out')).toBeDefined()
  expect(columnOf('Log in')).toBeUndefined()
  expect(r.stdout).toMatch(/01-login\.md: shape: stories: /)
  expect(r.stdout).toContain('no ticket cites the decided card #auth-session')
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, its correct blocker goes to ready', () => {
  project()
  writers({
    '01-a.md': ticket({ title: 'Ticket a', cites: 'auth', touches: null }),
    '02-b.md': ticket({ title: 'Ticket b', cites: 'auth-session', stories: '1' }),
    '03-c.md': ticket({ title: 'Ticket c', cites: 'auth-login', blocked: '1, 2', stories: '2' }),
  })
  p.werk(['plan', 'auth'])
  expect(columnOf('Ticket a')).toBeUndefined()
  expect(columnOf('Ticket c')).toBe('blocked')
  expect(columnOf('Ticket b')).toBe('ready')
})

test('82.5 a second plan archives an open ticket the new spec drops, and a restore puts it back', () => {
  project()
  const login = ticket({ title: 'Log in', cites: 'auth, auth-session, auth-login', stories: '1, 2' })
  writers({ '01-login.md': login, '02-logout.md': ticket({ title: 'Log out', cites: 'auth', stories: '2' }) })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(columnOf('Log in')).toBe('ready')
  expect(columnOf('Log out')).toBe('ready')

  writers({ '01-login.md': login })
  p.werk(['plan', 'auth'])
  const archived = boardLog().filter((e) => e.type === 'ticket.archived')
  expect(archived).toHaveLength(1)
  expect(archived[0]!.payload).toMatchObject({ number: 2 })
  expect((archived[0]!.payload as { reason: string }).reason).toMatch(/spec.*no longer needs it/)
  expect(columnOf('Log in')).toBe('ready')
  expect(columnOf('Log out')).toBeUndefined()

  // The person restores "logout". The help lists no board restore; try the restore verb with its number, then its slug.
  const byNumber = p.werk(['restore', '2'])
  const bySlug = byNumber.code === 0 ? byNumber : p.werk(['restore', 'logout'])
  expect({ code: bySlug.code, column: columnOf('Log out') }).toEqual({ code: 0, column: expect.stringMatching(/ready|blocked/) })
})
