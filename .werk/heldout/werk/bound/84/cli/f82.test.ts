/** Feature 82, steps 2 to 5: the plan verb with fake writers. */
import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { BoardEvent } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import { accepted, events, makeProject, proposed, seed, type Project } from './helpers.ts'

let p: Project
afterEach(() => p?.cleanup())
const PLAN = '.werk/plans/auth'
const SPEC = ['# Spec: auth', '', '## User Stories', '', '1. As a person, I want to log in.', '2. As a person, I want to log out.', ''].join('\n')
const ticket = (title: string, o: { cites: string; stories?: string | null; blocked?: string; touches?: string }) =>
  [
    `title: ${title}`,
    `cites: ${o.cites}`,
    `blocked_by: ${o.blocked ?? ''}`,
    ...(o.stories === null ? [] : [`stories: ${o.stories ?? '1'}`]),
    `touches: ${o.touches ?? 'session store'}`,
    '',
    '## What to build',
    '',
    `Build ${title.toLowerCase()} for the person.`,
    '',
    '## Acceptance criteria',
    '',
    '- [ ] It works for the person.',
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
const edit = (path: string, content: string) => ({ edit: { path, content } })
const answer = (slug: string) => ({ slug, title: `Answer ${slug}`, why: `Which ${slug}?`, body: `The body of ${slug}.` })

function writers(tickets: Record<string, string>, specAnswers: unknown[] = []) {
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify(specAnswers))] },
      'ticket-writer': {
        steps: [...Object.entries(tickets).map(([n, t]) => edit(`${PLAN}/tickets/${n}`, t)), edit(`${PLAN}/tickets.answers.json`, '[]')],
      },
    },
  })
}
const decidedAuth = (...extra: Parameters<typeof seed>[1][]) =>
  seed(
    p,
    proposed('auth', { title: 'Auth', status: 'decided' }),
    accepted('auth'),
    proposed('auth-session', { title: 'Sessions', status: 'decided', parent: 'auth' }),
    accepted('auth-session'),
    ...extra,
  )
const board = () => foldBoard(readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl')))
const boardLog = () => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
const onBoard = () => board().columns.flatMap((c) => c.tickets.map((t) => ({ title: t.title, column: c.name })))

test('82.2 a plan stops with an error when an answer record has an id that is already in the map', () => {
  p = makeProject()
  decidedAuth(proposed('auth-token-ttl', { title: 'The existing card', parent: 'auth' }), accepted('auth-token-ttl'))
  writers(
    { '01-login.md': ticket('Log in', { cites: 'auth, auth-session', stories: '1, 2' }) },
    [answer('token-ttl')],
  )
  const r = p.werk(['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  expect(events(p).filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl')).toHaveLength(1)
  expect(p.werk(['show', 'auth-token-ttl']).stdout).toContain('The existing card')
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  p = makeProject()
  decidedAuth()
  writers({
    '01-login.md': ticket('login', { cites: 'auth-session', stories: null }),
    '02-logout.md': ticket('logout', { cites: 'auth', stories: '1, 2' }),
  })
  const r = p.werk(['plan', 'auth'])
  const titles = onBoard().map((t) => t.title)
  expect(titles).toContain('logout')
  expect(titles).not.toContain('login')
  expect(r.stdout).toMatch(/01-login\.md: .*stories/)
  expect(r.stdout).toMatch(/no ticket cites the decided card #?auth-session/)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its correct blockers go to ready', () => {
  p = makeProject()
  decidedAuth()
  writers({
    '01-a.md': ticket('a', { cites: 'auth', stories: null }),
    '02-b.md': ticket('b', { cites: 'auth, auth-session', stories: '1, 2' }),
    '03-c.md': ticket('c', { cites: 'auth', stories: '1', blocked: '1, 2' }),
  })
  p.werk(['plan', 'auth'])
  const tickets = onBoard()
  expect(tickets.map((t) => t.title)).not.toContain('a')
  expect(tickets.find((t) => t.title === 'c')?.column).toBe('blocked')
  expect(tickets.find((t) => t.title === 'b')?.column).toBe('ready')
})

test('82.5 a second plan archives an open ticket that the new spec drops, and a restore puts it back', () => {
  p = makeProject()
  decidedAuth()
  writers({
    '01-login.md': ticket('login', { cites: 'auth', stories: '1' }),
    '02-logout.md': ticket('logout', { cites: 'auth-session', stories: '2' }),
  })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(onBoard().map((t) => t.title).toSorted()).toEqual(['login', 'logout'])
  writers({ '01-login.md': ticket('login', { cites: 'auth, auth-session', stories: '1, 2' }) })
  p.werk(['plan', 'auth'])
  const archived = boardLog().find((e) => e.type === 'ticket.archived')
  expect(archived).toMatchObject({ type: 'ticket.archived', payload: { number: 2 } })
  expect((archived!.payload as { reason: string }).reason).toMatch(/current spec .* no longer needs it/)
  expect(onBoard()).toContainEqual({ title: 'login', column: 'ready' })
  // The person restores logout. No verb restores a ticket; the map restore verb is the only restore there is.
  const help = p.werk(['help']).stdout
  console.log('82.5 restore verbs:', help.split('\n').filter((l) => /restore/.test(l)).join(' | '))
  const restore = p.werk(['restore', '2'])
  console.log('82.5 werk restore 2:', restore.code, restore.stderr.trim())
  expect(onBoard()).toContainEqual({ title: 'logout', column: 'ready' })
})
