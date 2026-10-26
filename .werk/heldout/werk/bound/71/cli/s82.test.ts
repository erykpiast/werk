import { afterEach, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { BoardEvent } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'
import { mkdirSync, writeFileSync } from 'node:fs'
import { isGhost, isReal, logEvents, makeProject, ok, out, show, type Project } from './helpers.ts'
import { ticketText, type T } from './tickets.ts'

let p: Project
let server: ReturnType<typeof Bun.spawn> | undefined
afterEach(() => {
  server?.kill()
  server = undefined
  p?.cleanup()
})

const PLAN = '.werk/plans/auth'
const SPEC = ['# Spec', '', '## User Stories', '', '1. As a person, I want to log in, so that I work.', '2. As a person, I want to log out, so that I leave.', ''].join('\n')

/** A map with the decided subtree under "auth": auth, auth-login-card and auth-session, each real and decided. */
const project = (extra: string[] = []) => {
  p = makeProject()
  const ids = ['auth-login-card', 'auth-session', ...extra]
  const log = logOf(
    proposed('auth', { status: 'decided', who: 'you' }),
    ...ids.map((id) => proposed(id, { status: 'decided', parent: 'auth' })),
    accepted('auth'),
    ...ids.map((id) => accepted(id)),
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

type Answer = { slug: string; title: string; why: string; body: string }
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })
const writers = (tickets: Record<string, string>, answers: { spec?: Answer[]; tickets?: Answer[] } = {}) =>
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify(answers.spec ?? []))] },
      'ticket-writer': {
        steps: [
          ...Object.entries(tickets).map(([n, t]) => edit(`${PLAN}/tickets/${n}`, t)),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify(answers.tickets ?? [])),
        ],
      },
    },
  })
const tk = (t: Partial<T> & { title: string }) => ticketText({ cites: 'auth, auth-login-card, auth-session', stories: '1, 2', touches: 'login flow', ...t })
const boardLog = () => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
const board = () => foldBoard(boardLog())
const columnOf = (title: string) => board().columns.find((c) => c.tickets.some((t) => t.title === title))?.name

const startServer = async () => {
  server = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts'), 'serve', '--port', '0'], { cwd: p.dir, env: p.env, stdout: 'pipe', stderr: 'pipe' })
  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader()
  let text = ''
  while (!/http:\/\/\S+\//.test(text)) {
    const { value, done } = await reader.read()
    if (done) throw new Error('server ended: ' + text)
    text += new TextDecoder().decode(value)
  }
  return /http:\/\/\S+\//.exec(text)![0]
}

test('82.1 a plan records a feature run, writes spec and tickets, and puts answers on the map as proposals', async () => {
  project()
  writers(
    { '1-login.md': tk({ title: 'Log in', stories: '1' }), '2-logout.md': tk({ title: 'Log out', stories: '2', blocked: '1' }) },
    {
      spec: [{ slug: 'token-ttl', title: 'Tokens live one hour', why: 'How long does a token live?', body: 'One hour, then refresh.' }],
      tickets: [{ slug: 'split-login', title: 'Split login in two', why: 'One ticket or two?', body: 'Two tickets.' }],
    },
  )
  const before = boardLog().length
  const r = p.werk(['plan', 'auth'])
  expect(out(r)).not.toContain('problem(s) in all, x')
  expect(r.code).toBe(0)
  const run = boardLog().slice(before)
  expect(run[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  const titles = board().columns.flatMap((c) => c.tickets.map((t) => t.title))
  expect(titles).toEqual(expect.arrayContaining(['Log in', 'Log out']))
  for (const [id, title, why, body] of [
    ['auth-token-ttl', 'Tokens live one hour', 'How long does a token live?', 'One hour, then refresh.'],
    ['auth-split-login', 'Split login in two', 'One ticket or two?', 'Two tickets.'],
  ]) {
    const s = show(p, id!)
    expect(s).toContain('state: ghost')
    expect(s).toContain('parent: #auth')
    expect(s).toContain('who: me')
    expect(s).toContain(title!)
    expect(s).toContain(why!)
    expect(s).toContain(body!)
  }
  const url = await startServer()
  for (const id of ['auth-token-ttl', 'auth-split-login']) {
    const res = await fetch(`${url}api/accept/${id}`, { method: 'POST' })
    expect(res.status).toBeLessThan(300)
    expect(isReal(p, id)).toBe(true)
  }
  const accepts = logEvents(p).filter((e) => e.type === 'node.accepted' && ['auth-token-ttl', 'auth-split-login'].includes(String(e.payload.id)))
  expect(accepts.map((e) => [e.payload.id, e.actor])).toEqual([
    ['auth-token-ttl', 'you'],
    ['auth-split-login', 'you'],
  ])
}, 60000)

test('82.2 a plan stops with an error when an answer record id is already in the map', () => {
  project(['auth-token-ttl'])
  writers({ '1-login.md': tk({ title: 'Log in' }) }, { spec: [{ slug: 'token-ttl', title: 'TTL', why: 'Why?', body: 'Body' }] })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(out(r)).toContain('token-ttl')
  const n = logEvents(p).filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl')
  expect(n).toHaveLength(1)
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  project()
  const login = tk({ title: 'Log in', cites: 'auth, auth-session', stories: '1' }).replace(/^stories:.*\n/m, '')
  const logout = tk({ title: 'Log out', cites: 'auth, auth-login-card', stories: '1, 2' })
  writers({ '1-login.md': login, '2-logout.md': logout })
  const r = p.werk(['plan', 'auth'])
  const titles = board().columns.flatMap((c) => c.tickets.map((t) => t.title))
  expect(titles).toContain('Log out')
  expect(titles).not.toContain('Log in')
  expect(out(r)).toMatch(/1-login\.md: shape: stories:/)
  expect(out(r)).toMatch(/no ticket cites the decided card #auth-session/)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its correct blockers go to ready', () => {
  project()
  writers({
    '1-a.md': tk({ title: 'Ticket a', stories: '1' }).replace(/^touches:.*\n/m, ''),
    '2-b.md': tk({ title: 'Ticket b', stories: '1, 2' }),
    '3-c.md': tk({ title: 'Ticket c', stories: '2', blocked: '1, 2' }),
  })
  p.werk(['plan', 'auth'])
  expect(columnOf('Ticket a')).toBeUndefined()
  expect(columnOf('Ticket c')).toBe('blocked')
  expect(columnOf('Ticket b')).toBe('ready')
})

test('82.5 a second plan archives a dropped open ticket, and a restore puts it back', () => {
  project()
  writers({ '1-login.md': tk({ title: 'login', stories: '1, 2' }), '2-logout.md': tk({ title: 'logout', stories: '1, 2' }) })
  ok(p, ['plan', 'auth'])
  expect(columnOf('login')).toBe('ready')
  expect(columnOf('logout')).toBe('ready')
  writers({ '1-login.md': tk({ title: 'login', stories: '1, 2' }) })
  p.werk(['plan', 'auth'])
  const archived = boardLog().find((e) => e.type === 'ticket.archived')
  expect(archived).toMatchObject({ payload: { number: 2 } })
  expect((archived!.payload as { reason: string }).reason).toMatch(/no longer needs/)
  expect(['ready', 'blocked']).toContain(columnOf('login')!)
  const help = p.werk(['help']).stdout
  const verb = /^\s*(restore|unarchive)\b/m.exec(help)?.[1]
  expect(verb).toBeDefined()
  ok(p, [verb!, '2'])
  expect(['ready', 'blocked']).toContain(columnOf('logout')!)
})
