/** Held-out steps 82.1-82.5: the plan verb, run as a process with fake writers. */
import { afterEach, expect, test } from 'bun:test'
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
let p: Project
afterEach(() => p?.cleanup())

const SPEC = '# Spec: auth\n\n## User Stories\n\n1. As a person, I want to log in, so that I see my map.\n2. As a person, I want to log out, so that I leave.\n'

function project(extra: ReturnType<typeof proposed>[] = []): Project {
  p = makeProject()
  const log = logOf(
    proposed('auth', { status: 'decided', title: 'Auth' }),
    accepted('auth'),
    proposed('auth-session', { status: 'decided', parent: 'auth', title: 'A session' }),
    accepted('auth-session'),
    proposed('auth-tokens', { status: 'decided', parent: 'auth', title: 'Tokens' }),
    accepted('auth-tokens'),
    ...extra,
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return p
}

type Answer = { slug: string; title: string; why: string; body: string }
const ans = (slug: string): Answer => ({ slug, title: `Title ${slug}`, why: `Why ${slug}?`, body: `Body ${slug}.` })
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })

const ticketText = (o: { title: string; cites: string; blocked?: string; stories?: string | null; touches: string }) =>
  [
    `title: ${o.title}`,
    `cites: ${o.cites}`,
    `blocked_by: ${o.blocked ?? ''}`,
    ...(o.stories === null ? [] : [`stories: ${o.stories ?? ''}`]),
    `touches: ${o.touches}`,
    '',
    '## What to build',
    '',
    `Build ${o.title.toLowerCase()}.`,
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

const LOGIN = ticketText({ title: 'A person can log in', cites: 'auth, auth-session', stories: '1', touches: 'login form' })
const LOGOUT = ticketText({ title: 'A person can log out', cites: 'auth-tokens', stories: '2', touches: 'logout button' })

function writers(tickets: Record<string, string>, answers: { spec?: Answer[]; tickets?: Answer[] } = {}) {
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
}

const mapLog = () => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))
const boardLog = () => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
/** "The board shows": the board fold, which the board view draws. */
const board = () => foldBoard(boardLog())
const columnOf = (title: string) => board().columns.find((c) => c.tickets.some((t) => t.title === title))?.name
const OPEN = ['blocked', 'ready', 'building', 'merging']

test('82.1 a plan records a feature run, writes a spec and tickets, and proposes the answers', () => {
  project()
  const before = mapLog().length
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT }, { spec: [ans('token-ttl')], tickets: [ans('split-login')] })
  const r = p.werk(['plan', 'auth'])
  expect(r.stderr).toBe('')
  expect(r.code).toBe(0)
  // The first event of the run is the tier event.
  expect(boardLog()[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  const titles = board().columns.flatMap((c) => c.tickets.map((t) => t.title))
  expect(titles.toSorted()).toEqual(['A person can log in', 'A person can log out'])
  const state = fold(mapLog())
  for (const slug of ['token-ttl', 'split-login']) {
    const id = `auth-${slug}`
    const node = state.nodes.get(id)
    expect(node).toMatchObject({ proposed: true, title: `Title ${slug}`, why: `Why ${slug}?`, body: `Body ${slug}.` })
    // The plan writes who "me": the agent that writes the card is the one who decides.
    expect(['me', 'agent']).toContain(node!.who!)
    expect(state.ghostEdges).toContainEqual({ from: id, to: 'auth', type: 'refines' })
    const show = p.werk(['show', id])
    expect(show.stdout).toContain(`Title ${slug}`)
    expect(show.stdout).toContain(`Why ${slug}?`)
    expect(show.stdout).toContain(`Body ${slug}.`)
  }
  expect(mapLog().length).toBe(before + 2)
  // The ✓ button appends a node.accepted by the person; the accept verb with --actor you is that same act.
  for (const id of ['auth-token-ttl', 'auth-split-login']) {
    const a = p.werk(['accept', id, '--actor', 'you'])
    expect(a.code).toBe(0)
    expect(mapLog().at(-1)).toMatchObject({ type: 'node.accepted', actor: 'you', payload: { id } })
    expect(fold(mapLog()).nodes.get(id)!.proposed).toBe(false)
  }
}, 60_000)

test('82.2 an answer whose id is already in the map stops the plan with an error that names it', () => {
  project([proposed('auth-token-ttl', { status: 'open', parent: 'auth', title: 'Existing ttl' }), accepted('auth-token-ttl')])
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT }, { spec: [ans('token-ttl')] })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  expect(mapLog().filter((e) => e.type === 'node.proposed' && (e.payload as { id: string }).id === 'auth-token-ttl')).toHaveLength(1)
  expect(fold(mapLog()).nodes.get('auth-token-ttl')).toMatchObject({ title: 'Existing ttl', proposed: false })
}, 60_000)

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  project()
  const login = ticketText({ title: 'login', cites: 'auth, auth-session', stories: null, touches: 'login form' })
  const logout = ticketText({ title: 'logout', cites: 'auth, auth-tokens', stories: '1, 2', touches: 'logout button' })
  writers({ '01-login.md': login, '02-logout.md': logout })
  const r = p.werk(['plan', 'auth'])
  const out = r.stdout + r.stderr
  expect(columnOf('logout')).toBeDefined()
  expect(columnOf('login')).toBeUndefined()
  expect(out).toMatch(/01-login\.md.*stories/)
  expect(out).toMatch(/no ticket cites.*#?auth-session/)
}, 60_000)

test('82.4 a ticket that names a failed ticket as a blocker is blocked, and its correct blocker goes to ready', () => {
  project()
  const a = ticketText({ title: 'a', cites: 'auth', stories: null, touches: 'alpha' })
  const b = ticketText({ title: 'b', cites: 'auth, auth-session', stories: '1', touches: 'beta' })
  const c = ticketText({ title: 'c', cites: 'auth-tokens', blocked: '1, 2', stories: '2', touches: 'gamma' })
  writers({ '01-a.md': a, '02-b.md': b, '03-c.md': c })
  p.werk(['plan', 'auth'])
  expect(columnOf('a')).toBeUndefined()
  expect(columnOf('c')).toBe('blocked')
  expect(columnOf('b')).toBe('ready')
}, 60_000)

test('82.5 a second plan archives an open ticket the new spec drops, and a restore puts it back', () => {
  project()
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(OPEN).toContain(columnOf('A person can log in'))
  expect(OPEN).toContain(columnOf('A person can log out'))

  writers({ '01-login.md': LOGIN })
  p.werk(['plan', 'auth'])
  const arch = boardLog().find((e) => e.type === 'ticket.archived')
  expect(arch).toMatchObject({ payload: { number: 2 } })
  expect((arch!.payload as { reason: string }).reason).toMatch(/current spec .*no longer needs it/)
  expect(board().archived.map((t) => t.title)).toEqual(['A person can log out'])
  expect(OPEN).toContain(columnOf('A person can log in'))

  const r = p.werk(['ticket', 'restore', '2', '--actor', 'you'])
  expect(r.code).toBe(0)
  expect(OPEN).toContain(columnOf('A person can log out'))
}, 60_000)
