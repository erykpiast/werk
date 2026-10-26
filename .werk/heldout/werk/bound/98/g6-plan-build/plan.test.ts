/** Held-out steps 82.1–82.5: the plan verb over a decided subtree "#auth". */
import { expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { Event } from '../../src/map/events.ts'
import { fold } from '../../src/map/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, serveProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

const PLAN = '.werk/plans/auth'
const SPEC = `# Spec: auth

## Problem Statement

A person cannot log in.

## User Stories

1. As a person, I want to log in, so that I see my map.
2. As a person, I want to log out, so that I leave the map.
`

type T = { title: string; cites: string; blocked?: string; stories: string; touches: string; noStories?: boolean }
const ticket = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    ...(t.noStories ? [] : [`stories: ${t.stories}`]),
    `touches: ${t.touches}`,
    '',
    '## What to build',
    '',
    `The person can ${t.title.toLowerCase()}.`,
    '',
    '## Acceptance criteria',
    '',
    `- [ ] The person can ${t.title.toLowerCase()}.`,
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

const answer = (slug: string) => ({ slug, title: `Title of ${slug}`, why: `Why ${slug}?`, body: `Body of ${slug}.` })
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })

function project(extra: Event[] = []): Project {
  const p = makeProject()
  const log = [
    ...logOf(
      proposed('auth', { status: 'decided', who: 'you' }),
      proposed('auth-session', { status: 'decided', parent: 'auth' }),
      proposed('auth-logout', { status: 'decided', parent: 'auth' }),
      accepted('auth-session'),
      accepted('auth-logout'),
    ),
    ...extra,
  ]
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return p
}

function writers(p: Project, tickets: Record<string, string>, answers: { spec?: unknown[]; tickets?: unknown[] } = {}) {
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

const LOGIN = ticket({ title: 'Log in', cites: 'auth, auth-session', stories: '1', touches: 'login' })
const LOGOUT = ticket({ title: 'Log out', cites: 'auth-logout', stories: '2', touches: 'logout' })

const mapLog = (p: Project) => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))
const boardLog = (p: Project) => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
const boardTickets = (p: Project) =>
  foldBoard(boardLog(p)).columns.flatMap((c) => c.tickets.map((t) => ({ column: c.name, title: t.title, number: t.number })))

test('82.1 a plan records a feature run, writes a spec and tickets, and proposes the answers as ghosts', async () => {
  const p = project()
  writers(p, { '01-login.md': LOGIN, '02-logout.md': LOGOUT }, { spec: [answer('token-ttl')], tickets: [answer('split-login')] })
  const r = p.werk(['plan', 'auth'])
  if (r.code !== 0) console.log(r.stdout, r.stderr)
  expect(r.code).toBe(0)

  const [first] = boardLog(p)
  expect(first).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  expect(boardTickets(p).map((t) => t.title).toSorted()).toEqual(['Log in', 'Log out'])

  const state = fold(mapLog(p))
  for (const slug of ['token-ttl', 'split-login']) {
    const node = state.nodes.get(`auth-${slug}`)
    expect(node).toMatchObject({ proposed: true, who: 'me', title: `Title of ${slug}`, why: `Why ${slug}?`, body: `Body of ${slug}.` })
    expect(state.ghostEdges).toContainEqual({ from: `auth-${slug}`, to: 'auth', type: 'refines' })
  }

  // The ✓ button posts to the accept route of the map page; accept one ghost at a time.
  const server = serveProject(p)
  const url = await server.url
  const res1 = await fetch(`${url}api/accept/auth-token-ttl`, { method: 'POST', headers: { origin: url.slice(0, -1) } })
  expect(res1.status).toBe(200)
  const mid = fold(mapLog(p))
  expect(mid.nodes.get('auth-token-ttl')?.proposed).toBeFalsy()
  expect(mid.nodes.get('auth-split-login')?.proposed).toBe(true)
  const res2 = await fetch(`${url}api/accept/auth-split-login`, { method: 'POST', headers: { origin: url.slice(0, -1) } })
  expect(res2.status).toBe(200)
  expect(fold(mapLog(p)).nodes.get('auth-split-login')?.proposed).toBeFalsy()
}, 30_000)

test('82.2 a plan stops with an error when an answer record id is already in the map', () => {
  const existing = logOf(proposed('auth-token-ttl', { parent: 'auth', title: 'Old token card' }), accepted('auth-token-ttl')).map((e, i) => ({ ...e, seq: 100 + i }))
  const p = project(existing)
  writers(p, { '01-login.md': LOGIN, '02-logout.md': LOGOUT }, { spec: [answer('token-ttl')] })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const proposals = mapLog(p).filter((e) => e.type === 'node.proposed' && (e.payload as { id: string }).id === 'auth-token-ttl')
  expect(proposals).toHaveLength(1)
  expect(fold(mapLog(p)).nodes.get('auth-token-ttl')?.title).toBe('Old token card')
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  const p = project()
  const login = ticket({ title: 'Log in', cites: 'auth, auth-session', stories: '1', touches: 'login', noStories: true })
  const logout = ticket({ title: 'Log out', cites: 'auth-logout', stories: '1, 2', touches: 'logout' })
  writers(p, { '01-login.md': login, '02-logout.md': logout })
  const r = p.werk(['plan', 'auth'])
  const titles = boardTickets(p).map((t) => t.title)
  expect(titles).toContain('Log out')
  expect(titles).not.toContain('Log in')
  expect(r.stdout).toMatch(/01-login\.md: .*stories/)
  expect(r.stdout).toMatch(/no ticket cites the decided card #auth-session/)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its correct blocker goes to ready', () => {
  const p = project()
  const a = ticket({ title: 'Ticket a', cites: 'auth-session', stories: '1', touches: 'a module', noStories: true })
  const b = ticket({ title: 'Ticket b', cites: 'auth-session', stories: '1', touches: 'b module' })
  const c = ticket({ title: 'Ticket c', cites: 'auth-logout', blocked: '1, 2', stories: '2', touches: 'c module' })
  writers(p, { '01-a.md': a, '02-b.md': b, '03-c.md': c })
  p.werk(['plan', 'auth'])
  const t = boardTickets(p)
  expect(t.find((x) => x.title === 'Ticket a')).toBeUndefined()
  expect(t.find((x) => x.title === 'Ticket c')?.column).toBe('blocked')
  expect(t.find((x) => x.title === 'Ticket b')?.column).toBe('ready')
})

test('82.5 a second plan archives an open ticket the new spec drops, and a restore puts it back', () => {
  const p = project()
  writers(p, { '01-login.md': LOGIN, '02-logout.md': LOGOUT })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(boardTickets(p).map((t) => t.title).toSorted()).toEqual(['Log in', 'Log out'])

  writers(p, { '01-login.md': ticket({ title: 'Log in', cites: 'auth, auth-session, auth-logout', stories: '1, 2', touches: 'login' }) })
  p.werk(['plan', 'auth'])
  const archived = boardLog(p).filter((e) => e.type === 'ticket.archived')
  expect(archived).toHaveLength(1)
  expect(JSON.stringify(archived[0])).toContain('no longer needs')
  expect(archived[0]).toMatchObject({ payload: { number: 2 } })
  expect(boardTickets(p).find((t) => t.title === 'Log in')?.column).toBe('ready')
  expect(boardTickets(p).find((t) => t.title === 'Log out')).toBeUndefined()

  const r = p.werk(['ticket', 'restore', '2'])
  expect(r.code).toBe(0)
  expect(boardTickets(p).find((t) => t.title === 'Log out')?.column).toBe('ready')
})
