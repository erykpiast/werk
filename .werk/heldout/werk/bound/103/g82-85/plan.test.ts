/** Held-out steps 82.1 to 82.5: the plan verb over a decided subtree, with fake writers. */
import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { Event } from '../../src/map/events.ts'
import { fold } from '../../src/map/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

const PLAN = '.werk/plans/auth'
const SPEC = '# Spec: auth\n\n## Problem Statement\n\nNo login.\n\n## User Stories\n\n1. As a person, I want to log in, so that I see my map.\n2. As a person, I want to log out, so that I leave.\n'

function project(extra: ReturnType<typeof proposed>[] = []): Project {
  const p = makeProject()
  const log = logOf(
    proposed('auth', { status: 'decided', who: 'you' }),
    proposed('auth-session', { status: 'decided', parent: 'auth' }),
    proposed('auth-other', { status: 'decided', parent: 'auth' }),
    accepted('auth-session'),
    accepted('auth-other'),
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
    ...(t.touches === null ? [] : [`touches: ${t.touches ?? 'sign in'}`]),
    '',
    '## What to build',
    '',
    `The ${t.title} flow.`,
    '',
    '## Acceptance criteria',
    '',
    `- The ${t.title} flow works.`,
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

type Answer = { slug: string; title: string; why: string; body: string }
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })
function writers(p: Project, tickets: Record<string, string>, answers: { spec?: Answer[]; tickets?: Answer[] } = {}) {
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
const mapLog = (p: Project) => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))
const boardLog = (p: Project) => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
const shown = (p: Project) =>
  Object.fromEntries(foldBoard(boardLog(p)).columns.flatMap((c) => c.tickets.map((t) => [t.title, c.name])))

const LOGIN = ticket({ title: 'login', cites: 'auth, auth-session', stories: '1' })
const LOGOUT = ticket({ title: 'logout', cites: 'auth-other', stories: '2', touches: 'sign out' })

test('82.1 a plan records a feature tier first, puts the tickets on the board, and proposes the answers as ghosts', () => {
  const p = project()
  const tokenTtl = { slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long does a token live?', body: 'A token expires after one hour.' }
  const split = { slug: 'split-login', title: 'Login is its own ticket', why: 'Is login split out?', body: 'Login ships alone.' }
  writers(p, { '01-login.md': LOGIN, '02-logout.md': LOGOUT }, { spec: [tokenTtl], tickets: [split] })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).toBe(0)
  const runEvents = boardLog(p)
  expect(runEvents[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  expect(shown(p)).toEqual({ login: 'ready', logout: 'ready' })
  const state = fold(mapLog(p))
  for (const [id, a] of [['auth-token-ttl', tokenTtl], ['auth-split-login', split]] as const) {
    const node = state.nodes.get(id)
    expect(node).toMatchObject({ proposed: true, title: a.title, why: a.why, body: a.body, who: 'me' })
    expect(state.ghostEdges).toContainEqual({ from: id, to: 'auth', type: 'refines' })
    // The who of the answer: the plan says the agent decides.
    const ev = mapLog(p).find((e) => e.type === 'node.proposed' && (e.payload as { id: string }).id === id)!
    expect(ev.actor).toBe('agent')
    const show = p.werk(['show', id])
    expect(show.code).toBe(0)
    expect(show.stdout).toContain(a.title)
    expect(show.stdout).toContain(a.why)
    expect(show.stdout).toContain(a.body)
  }
  // Each ghost can be accepted alone.
  expect(p.werk(['accept', 'auth-token-ttl', '--actor', 'you']).code).toBe(0)
  const after = fold(mapLog(p))
  expect(after.nodes.get('auth-token-ttl')?.proposed).toBe(false)
  expect(after.nodes.get('auth-split-login')?.proposed).toBe(true)
}, 30_000)

test('82.2 an answer whose id is already in the map makes the plan exit with an error and adds no second card', () => {
  const p = project([proposed('auth-token-ttl', { parent: 'auth' }), accepted('auth-token-ttl')])
  writers(p, { '01-login.md': LOGIN, '02-logout.md': LOGOUT }, { spec: [{ slug: 'token-ttl', title: 'T', why: 'W', body: 'B' }] })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const proposals = mapLog(p).filter((e) => e.type === 'node.proposed' && (e.payload as { id: string }).id === 'auth-token-ttl')
  expect(proposals).toHaveLength(1)
}, 30_000)

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  const p = project()
  const login = ticket({ title: 'login', cites: 'auth-session', stories: null })
  const logout = ticket({ title: 'logout', cites: 'auth, auth-other', stories: '1, 2', touches: 'sign out' })
  writers(p, { '01-login.md': login, '02-logout.md': logout })
  const r = p.werk(['plan', 'auth'])
  const board = shown(p)
  expect(board.logout).toBeDefined()
  expect(board.login).toBeUndefined()
  expect(r.stdout).toMatch(/01-login\.md: shape: stories/)
  expect(r.stdout).toContain('no ticket cites the decided card #auth-session')
}, 30_000)

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its correct blocker goes to ready', () => {
  const p = project()
  const a = ticket({ title: 'a', cites: 'auth', stories: '1', touches: null })
  const b = ticket({ title: 'b', cites: 'auth-session', stories: '1', touches: 'tokens' })
  const c = ticket({ title: 'c', cites: 'auth-other', blocked: '1, 2', stories: '2', touches: 'sessions' })
  writers(p, { '01-a.md': a, '02-b.md': b, '03-c.md': c })
  p.werk(['plan', 'auth'])
  const board = shown(p)
  expect(board.a).toBeUndefined()
  expect(board.c).toBe('blocked')
  expect(board.b).toBe('ready')
}, 30_000)

test('82.5 a second plan archives an open ticket the new spec drops, and a restore puts it back', () => {
  const p = project()
  writers(p, { '01-login.md': ticket({ title: 'login', cites: 'auth, auth-session, auth-other', stories: '1, 2' }), '02-logout.md': LOGOUT })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(shown(p)).toEqual({ login: 'ready', logout: 'ready' })
  writers(p, { '01-login.md': ticket({ title: 'login', cites: 'auth, auth-session, auth-other', stories: '1, 2' }) })
  p.werk(['plan', 'auth'])
  const archived = boardLog(p).filter((e) => e.type === 'ticket.archived')
  expect(archived).toHaveLength(1)
  expect(archived[0]).toMatchObject({ payload: { number: 2 } })
  expect((archived[0]!.payload as { reason: string }).reason).toMatch(/current spec .* no longer needs it/)
  expect(shown(p)).toEqual({ login: 'ready' })
  const r = p.werk(['ticket', 'restore', '2'])
  expect(r.code).toBe(0)
  expect(shown(p)).toEqual({ login: 'ready', logout: 'ready' })
}, 30_000)
