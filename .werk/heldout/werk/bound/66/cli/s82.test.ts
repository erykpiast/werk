import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import { ok, project, type P } from '../lib.ts'
import { accepted, proposed } from '../../src/test/map-events.ts'
import type { BoardEvent } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'

let p: P
afterEach(() => p?.cleanup())

const PLAN = '.werk/plans/auth'
const SPEC = ['# Spec', '', '## User Stories', '', '1. As a person, I want to log in.', '2. As a person, I want to log out.', '', '## Notes', ''].join('\n')

type T = { title: string; cites: string; blockedBy?: string; stories?: string; touches?: string }
const ticket = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: auth, ${t.cites}`,
    `blocked_by: ${t.blockedBy ?? ''}`,
    ...(t.stories === undefined ? [] : [`stories: ${t.stories}`]),
    `touches: ${t.touches ?? 'auth flow'}`,
    '',
    '## What to build',
    '',
    `A person can do ${t.title}.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] It works.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

type Answer = { slug: string; title: string; why: string; body: string }
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

/** A decided subtree under "auth". */
function setup(children: string[] = ['auth-login', 'auth-logout']) {
  p = project()
  p.seed(
    proposed('auth', { title: 'Auth', status: 'decided', who: 'you' }),
    accepted('auth'),
    ...children.flatMap((id) => [proposed(id, { title: id, status: 'decided', parent: 'auth' }), accepted(id)]),
  )
}

const board = () => foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
const boardLog = () => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
const columnOf = (title: string) => board().columns.find((c) => c.tickets.some((t) => t.title === title))?.name
const onBoard = (title: string) => columnOf(title) !== undefined

test('82.1 (command line part) a plan records a feature run, writes tickets, and proposes the answers as ghosts', () => {
  setup()
  writers(
    {
      '01-login.md': ticket({ title: 'login', cites: 'auth-login', stories: '1' }),
      '02-logout.md': ticket({ title: 'logout', cites: 'auth-logout', stories: '2' }),
    },
    {
      spec: [{ slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long does a token live?', body: 'One hour.' }],
      tickets: [{ slug: 'split-login', title: 'Split login in two', why: 'How many tickets for login?', body: 'Two.' }],
    },
  )
  const r = p.w('plan', 'auth')
  expect(r.code, r.stdout + r.stderr).toBe(0)
  const run = boardLog()
  expect(run[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  expect(onBoard('login')).toBe(true)
  expect(onBoard('logout')).toBe(true)
  for (const [id, title, why, body] of [
    ['auth-token-ttl', 'Tokens live one hour', 'How long does a token live?', 'One hour.'],
    ['auth-split-login', 'Split login in two', 'How many tickets for login?', 'Two.'],
  ] as const) {
    const show = ok(p.w('show', id)).stdout
    expect(show).toContain('ghost')
    expect(show).toContain('parent: #auth')
    expect(show).toContain('who: me')
    expect(show).toContain(title)
    expect(show).toContain(why)
    expect(show).toContain(body)
  }
})

test('82.2 a plan stops with an error when an answer record has an id that is already in the map', () => {
  setup()
  p.seed(proposed('auth-token-ttl', { title: 'An old card', parent: 'auth' }), accepted('auth-token-ttl'))
  writers(
    {
      '01-login.md': ticket({ title: 'login', cites: 'auth-login', stories: '1' }),
      '02-logout.md': ticket({ title: 'logout', cites: 'auth-logout', stories: '2' }),
    },
    { spec: [{ slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long?', body: 'One hour.' }] },
  )
  const r = p.w('plan', 'auth')
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const proposals = p.events().filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl')
  expect(proposals.length).toBe(1)
  expect(p.state().nodes.get('auth-token-ttl')?.title).toBe('An old card')
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  setup(['auth-session', 'auth-logout'])
  writers({
    '01-login.md': ticket({ title: 'login', cites: 'auth-session' }),
    '02-logout.md': ticket({ title: 'logout', cites: 'auth-logout', stories: '1, 2' }),
  })
  const r = p.w('plan', 'auth')
  const out = r.stdout + r.stderr
  expect(onBoard('logout')).toBe(true)
  expect(onBoard('login')).toBe(false)
  expect(out.split('\n').some((l) => l.includes('01-login.md') && l.includes('stories'))).toBe(true)
  expect(out.split('\n').some((l) => l.includes('cards-cited') && l.includes('#auth-session'))).toBe(true)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its correct blockers go to ready', () => {
  setup()
  writers({
    '01-a.md': ticket({ title: 'a', cites: 'auth-login' }),
    '02-b.md': ticket({ title: 'b', cites: 'auth-login', stories: '1' }),
    '03-c.md': ticket({ title: 'c', cites: 'auth-logout', blockedBy: '1, 2', stories: '2' }),
  })
  p.w('plan', 'auth')
  expect(onBoard('a')).toBe(false)
  expect(columnOf('c')).toBe('blocked')
  expect(columnOf('b')).toBe('ready')
})

test('82.5 a second plan archives an open ticket that the new spec drops, and a restore puts it back', () => {
  setup()
  writers({
    '01-login.md': ticket({ title: 'login', cites: 'auth-login, auth-logout', stories: '1' }),
    '02-logout.md': ticket({ title: 'logout', cites: 'auth-logout', stories: '2' }),
  })
  ok(p.w('plan', 'auth'))
  expect(onBoard('login')).toBe(true)
  expect(onBoard('logout')).toBe(true)

  writers({ '01-login.md': ticket({ title: 'login', cites: 'auth-login, auth-logout', stories: '1, 2' }) })
  p.w('plan', 'auth')
  const archived = boardLog().filter((e) => e.type === 'ticket.archived')
  expect(archived.length).toBe(1)
  expect(archived[0]).toMatchObject({ payload: { number: 2 } })
  expect((archived[0]!.payload as { reason: string }).reason).toMatch(/spec/)
  expect(['ready', 'blocked']).toContain(columnOf('login')!)
  expect(onBoard('logout')).toBe(false)

  // The person restores "logout". The command line names one restore verb.
  const r = p.w('restore', '2')
  const r2 = r.code === 0 ? r : p.w('restore', 'logout')
  expect(r2.code, `restore of a ticket: ${r.stderr} / ${r2.stderr}`).toBe(0)
  expect(['ready', 'blocked']).toContain(columnOf('logout')!)
})
