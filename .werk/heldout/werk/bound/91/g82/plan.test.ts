import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent } from '../../src/board/events.ts'
import { foldBoard } from '../../src/board/fold.ts'
import type { Event } from '../../src/map/events.ts'
import { readLog } from '../../src/map/log.ts'
import type { FakeStep } from '../../src/test/fake-agent.ts'
import { makeProject, type Project } from '../../src/test/harness.ts'
import { accepted, logOf, proposed } from '../../src/test/map-events.ts'

const PLAN = '.werk/plans/auth'
const SPEC = `# Spec: auth\n\n## Problem Statement\n\nNo login.\n\n## User Stories\n\n1. As a person, I want to log in, so that I work.\n2. As a person, I want to log out, so that I leave.\n\n## Implementation Decisions\n\n1. None.\n`

let p: Project
afterEach(() => p?.cleanup())

function project(extra: ReturnType<typeof proposed>[] = [], acc: string[] = []) {
  p = makeProject()
  const log = logOf(
    proposed('auth', { status: 'decided', who: 'you' }),
    proposed('auth-session', { status: 'decided', parent: 'auth' }),
    proposed('auth-cookie', { status: 'decided', parent: 'auth' }),
    accepted('auth-session'),
    accepted('auth-cookie'),
    ...extra,
    ...acc.map(accepted),
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

type T = { title: string; cites: string; blocked?: string; stories: string | null; touches?: string }
const ticket = (t: T) =>
  [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked ?? ''}`,
    ...(t.stories === null ? [] : [`stories: ${t.stories}`]),
    `touches: ${t.touches ?? 'login page'}`,
    '',
    '## What to build',
    '',
    `The person can ${t.title.toLowerCase()} from the page.`,
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

type A = { slug: string; title: string; why: string; body: string }
const ans = (slug: string): A => ({ slug, title: `Title ${slug}`, why: `Why ${slug}?`, body: `Body of ${slug}.` })
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })

function writers(tickets: Record<string, string>, specAnswers: A[] = [], ticketAnswers: A[] = []) {
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify(specAnswers))] },
      'ticket-writer': {
        steps: [
          ...Object.entries(tickets).map(([n, t]) => edit(`${PLAN}/tickets/${n}`, t)),
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
const LOGIN = ticket({ title: 'Login', cites: 'auth, auth-session', stories: '1' })
const LOGOUT = ticket({ title: 'Logout', cites: 'auth-cookie', stories: '2' })

test('82.1 a plan records feature tier, writes tickets, proposes answers as ghosts', async () => {
  project()
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT }, [ans('token-ttl')], [ans('split-login')])
  const before = boardLog().length
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  expect(r.code).toBe(0)
  const run = boardLog().slice(before)
  expect(run[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  const titles = board().columns.flatMap((c) => c.tickets.map((t) => t.title))
  expect(titles.toSorted()).toEqual(['Login', 'Logout'])
  for (const slug of ['token-ttl', 'split-login']) {
    const s = p.werk(['show', `auth-${slug}`])
    expect(s.code).toBe(0)
    expect(s.stdout).toContain('state: ghost')
    expect(s.stdout).toContain('parent: #auth')
    expect(s.stdout).toContain('who: me')
    expect(s.stdout).toContain(`Title ${slug}`)
    expect(s.stdout).toContain(`why: Why ${slug}?`)
    expect(s.stdout).toContain(`Body of ${slug}.`)
  }
  // The ✓ button POSTs /api/accept/<id> to the server; press it once per ghost.
  const server = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'main.ts'), 'serve', '--port', '0'], {
    cwd: p.dir,
    env: p.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  try {
    let out = ''
    const reader = server.stdout.getReader()
    while (!/http:\/\/\S+\//.test(out)) {
      const { value, done } = await reader.read()
      if (done) break
      out += new TextDecoder().decode(value)
    }
    const url = out.match(/http:\/\/\S+\//)![0]
    const a = await fetch(`${url}api/accept/auth-token-ttl`, { method: 'POST' })
    expect(a.status).toBe(200)
    expect(p.werk(['show', 'auth-token-ttl']).stdout).toContain('state: real')
    expect(p.werk(['show', 'auth-split-login']).stdout).toContain('state: ghost')
    const b = await fetch(`${url}api/accept/auth-split-login`, { method: 'POST' })
    expect(b.status).toBe(200)
    expect(p.werk(['show', 'auth-split-login']).stdout).toContain('state: real')
  } finally {
    server.kill('SIGTERM')
    await server.exited
  }
}, 60_000)

test('82.2 an answer whose id is in the map stops the plan with an error', () => {
  project([proposed('auth-token-ttl', { status: 'open', parent: 'auth' })], ['auth-token-ttl'])
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT }, [ans('token-ttl')])
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const proposals = mapLog().filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl')
  expect(proposals).toHaveLength(1)
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  project()
  const login = ticket({ title: 'login', cites: 'auth, auth-session', stories: null })
  const logout = ticket({ title: 'logout', cites: 'auth, auth-cookie', stories: '1, 2' })
  writers({ '01-login.md': login, '02-logout.md': logout })
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  const titles = board().columns.flatMap((c) => c.tickets.map((t) => t.title))
  expect(titles).toContain('logout')
  expect(titles).not.toContain('login')
  expect(r.stdout).toMatch(/01-login\.md.*stories/)
  expect(r.stdout).toMatch(/no ticket cites the decided card #auth-session/)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked; its good blocker is ready', () => {
  project()
  const a = ticket({ title: 'a', cites: 'auth', stories: null })
  const b = ticket({ title: 'b', cites: 'auth, auth-session', stories: '1' })
  const c = ticket({ title: 'c', cites: 'auth-cookie', stories: '2', blocked: '1, 2' })
  writers({ '01-a.md': a, '02-b.md': b, '03-c.md': c })
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  expect(columnOf('a')).toBeUndefined()
  expect(columnOf('c')).toBe('blocked')
  expect(columnOf('b')).toBe('ready')
})

test('82.5 a second plan archives a dropped open ticket, and a restore puts it back', () => {
  project()
  const login = ticket({ title: 'login', cites: 'auth, auth-session, auth-cookie', stories: '1, 2' })
  const logout = ticket({ title: 'logout', cites: 'auth-cookie', stories: '2' })
  writers({ '01-login.md': login, '02-logout.md': logout })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(columnOf('login')).toBe('ready')
  expect(columnOf('logout')).toBe('ready')
  writers({ '01-login.md': login })
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  const arch = boardLog().filter((e) => e.type === 'ticket.archived')
  expect(arch).toHaveLength(1)
  expect(arch[0]).toMatchObject({ payload: { number: 2 } })
  expect((arch[0]!.payload as { reason: string }).reason).toMatch(/no longer needs/)
  expect(columnOf('login')).toBe('ready')
  expect(columnOf('logout')).toBeUndefined()
  // The person restores logout. No ticket restore verb exists; try the restore verb with the number.
  const rs = p.werk(['restore', '2'])
  console.log('restore:', rs.code, rs.stdout, rs.stderr)
  expect(columnOf('logout')).toMatch(/ready|blocked/)
})
