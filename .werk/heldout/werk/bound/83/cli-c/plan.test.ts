/** Held-out steps 82.2-82.5 (and the command-line parts of 82.1): the plan verb with fake writers. */
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

const PLAN = '.werk/plans/auth'
let p: Project
afterEach(() => p?.cleanup())

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

const SPEC = '# Spec\n\n## User Stories\n\n1. As a person, I log in.\n2. As a person, I log out.\n'
type Answer = { slug: string; title: string; why: string; body: string }
const answer = (slug: string): Answer => ({ slug, title: `Title of ${slug}`, why: `Why ${slug}?`, body: `Body of ${slug}.` })
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })

type T = { title: string; cites: string; blocked_by?: string; stories?: string | null; touches?: string; what?: boolean }
function ticket(t: T): string {
  return [
    `title: ${t.title}`,
    `cites: ${t.cites}`,
    `blocked_by: ${t.blocked_by ?? ''}`,
    ...(t.stories === null ? [] : [`stories: ${t.stories ?? '1'}`]),
    `touches: ${t.touches ?? 'login form'}`,
    '',
    ...(t.what === false ? [] : ['## What to build', '', `Build ${t.title}.`, '']),
    '## Acceptance criteria',
    '',
    `- [ ] ${t.title} works.`,
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')
}

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
const where = (title: string) => board().columns.find((c) => c.tickets.some((t) => t.title === title))?.name

test('82.1 (command line part) a plan records a feature tier first, puts two tickets on the board, and proposes ghosts', () => {
  project()
  writers(
    {
      '01-login.md': ticket({ title: 'Log in', cites: 'auth, auth-login', stories: '1' }),
      '02-logout.md': ticket({ title: 'Log out', cites: 'auth-session', stories: '2', blocked_by: '1' }),
    },
    { spec: [answer('token-ttl')], tickets: [answer('split-login')] },
  )
  const startSeq = boardLog().length
  const r = p.werk(['plan', 'auth'])
  console.log('82.1', JSON.stringify(r))
  expect(r.code).toBe(0)
  const run = boardLog().slice(startSeq)
  expect(run[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  expect(board().columns.flatMap((c) => c.tickets.map((t) => t.title)).toSorted()).toEqual(['Log in', 'Log out'])
  for (const slug of ['token-ttl', 'split-login']) {
    const show = p.werk(['show', `auth-${slug}`])
    console.log(show.stdout)
    expect(show.stdout).toContain('state: ghost')
    expect(show.stdout).toContain('parent: #auth')
    expect(show.stdout).toContain('who: me')
    expect(show.stdout).toContain(`Title of ${slug}`)
    expect(show.stdout).toContain(`why: Why ${slug}?`)
    expect(show.stdout).toContain(`Body of ${slug}.`)
  }
})

test('82.2 a plan stops with an error when an answer id is already in the map', () => {
  project([proposed('auth-token-ttl', { parent: 'auth', title: 'Existing ttl card' }), accepted('auth-token-ttl')])
  writers({ '01-login.md': ticket({ title: 'Log in', cites: 'auth, auth-login, auth-session', stories: '1, 2' }) }, { spec: [answer('token-ttl')] })
  const r = p.werk(['plan', 'auth'])
  console.log('82.2', JSON.stringify(r))
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  expect(mapLog().filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl')).toHaveLength(1)
  expect(p.werk(['show', 'auth-token-ttl']).stdout).toContain('Existing ttl card')
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  project()
  writers({
    '01-login.md': ticket({ title: 'login', cites: 'auth-session', stories: null }),
    '02-logout.md': ticket({ title: 'logout', cites: 'auth, auth-login', stories: '1, 2' }),
  })
  const r = p.werk(['plan', 'auth'])
  console.log('82.3', JSON.stringify(r))
  expect(where('logout')).toBeDefined()
  expect(where('login')).toBeUndefined()
  expect(r.stdout).toMatch(/01-login\.md: shape: stories: /)
  expect(r.stdout).toMatch(/no ticket cites the decided card #auth-session/)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its correct blocker goes to ready', () => {
  project()
  writers({
    '01-a.md': ticket({ title: 'a', cites: 'auth', stories: '1', what: false }),
    '02-b.md': ticket({ title: 'b', cites: 'auth, auth-login', stories: '1' }),
    '03-c.md': ticket({ title: 'c', cites: 'auth-session', stories: '2', blocked_by: '1, 2' }),
  })
  const r = p.werk(['plan', 'auth'])
  console.log('82.4', JSON.stringify(r), JSON.stringify(board().columns.map((c) => [c.name, c.tickets.map((t) => t.title)])))
  expect(where('a')).toBeUndefined()
  expect(where('c')).toBe('blocked')
  expect(where('b')).toBe('ready')
})

test('82.5 a second plan archives an open ticket the new spec drops, and a restore puts it back', () => {
  project()
  const login = ticket({ title: 'login', cites: 'auth, auth-login, auth-session', stories: '1, 2' })
  const logout = ticket({ title: 'logout', cites: 'auth', stories: '2' })
  writers({ '01-login.md': login, '02-logout.md': logout })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(where('login')).toBe('ready')
  expect(where('logout')).toBe('ready')

  writers({ '01-login.md': login })
  const r = p.werk(['plan', 'auth'])
  console.log('82.5 second', JSON.stringify(r))
  const archived = boardLog().find((e) => e.type === 'ticket.archived')
  expect(archived).toMatchObject({ payload: { number: 2, reason: expect.stringMatching(/current spec .* no longer needs it/) } })
  expect(['ready', 'blocked']).toContain(where('login')!)
  expect(where('logout')).toBeUndefined()

  // The person restores logout. The only restore verb is `werk restore`; try it with the ticket.
  const help = p.werk(['help']).stdout
  console.log('82.5 help restore lines', help.split('\n').filter((l) => /restore|archiv|board/.test(l)))
  const restore = p.werk(['restore', '2'])
  console.log('82.5 restore', JSON.stringify(restore))
  expect(['ready', 'blocked']).toContain(where('logout') ?? 'none')
})
