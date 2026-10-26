/** Held-out steps 82.1–82.5: the plan verb, run as a process with fake writers. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardEvent } from '../src/board/events.ts'
import { foldBoard } from '../src/board/fold.ts'
import type { Event } from '../src/map/events.ts'
import { fold } from '../src/map/fold.ts'
import { readLog } from '../src/map/log.ts'
import { startServer } from '../src/server/server.ts'
import type { FakeStep } from '../src/test/fake-agent.ts'
import { makeProject, type Project } from '../src/test/harness.ts'
import { accepted, logOf, proposed } from '../src/test/map-events.ts'

const PLAN = '.werk/plans/auth'
let p: Project
afterEach(() => p?.cleanup())

function project(extra: ReturnType<typeof proposed>[] = []): Project {
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

const SPEC = `# Spec: auth

## User Stories

1. As a person, I want to log in, so that I see my work.
2. As a person, I want to log out, so that I leave.
`

const ticket = (o: { title: string; cites: string; blocked?: string; stories: string; noStories?: boolean }) =>
  [
    `title: ${o.title}`,
    `cites: ${o.cites}`,
    `blocked_by: ${o.blocked ?? ''}`,
    ...(o.noStories ? [] : [`stories: ${o.stories}`]),
    'touches: map view',
    '',
    '## What to build',
    '',
    `The person can ${o.title.toLowerCase()}.`,
    '',
    '## Acceptance criteria',
    '',
    `- [ ] ${o.title} works.`,
    '',
    '## Checks',
    '',
    '- `make test`',
    '',
  ].join('\n')

type Answer = { slug: string; title: string; why: string; body: string }
const ans = (slug: string): Answer => ({ slug, title: `Title ${slug}`, why: `Which ${slug}?`, body: `Body of ${slug}.` })
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })

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
const board = () => foldBoard(boardLog())
const columnOf = (n: number) => board().columns.find((c) => c.tickets.some((t) => t.number === n))?.name
const onBoard = (n: number) => columnOf(n) !== undefined

const LOGIN = ticket({ title: 'Log in', cites: 'auth, auth-login, auth-session', stories: '1' })
const LOGOUT = ticket({ title: 'Log out', cites: 'auth, auth-login, auth-session', stories: '2' })

test('82.1 a plan records a feature run, writes spec and tickets, and proposes the answers as ghosts', async () => {
  project()
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT }, { spec: [ans('token-ttl')], tickets: [ans('split-login')] })
  const startSeq = boardLog().length
  const r = p.werk(["plan", "auth"])
  if (r.code !== 0) console.log(r.stdout, r.stderr)
  expect(r.code).toBe(0)
  const run = boardLog().slice(startSeq)
  expect(run[0]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  expect(onBoard(1) && onBoard(2)).toBe(true)
  const state = fold(mapLog())
  for (const slug of ['token-ttl', 'split-login']) {
    const id = `auth-${slug}`
    const node = state.nodes.get(id)
    expect(node).toMatchObject({ proposed: true, who: 'me', title: `Title ${slug}`, why: `Which ${slug}?`, body: `Body of ${slug}.` })
    expect(state.ghostEdges).toContainEqual({ from: id, to: 'auth', type: 'refines' })
    const show = p.werk(['show', id]).stdout
    expect(show).toContain(`Title ${slug}`)
    expect(show).toContain(`Which ${slug}?`)
    expect(show).toContain(`Body of ${slug}.`)
  }
  // The ✓ button: the server's accept route, one ghost at a time.
  const server = await startServer({ logPath: join(p.dir, '.werk', 'log.jsonl'), host: '127.0.0.1', port: 0 })
  try {
    const res1 = await fetch(`http://127.0.0.1:${server.port}/api/accept/auth-token-ttl`, { method: 'POST' })
    expect(res1.ok).toBe(true)
    let s = fold(mapLog())
    expect(s.nodes.get('auth-token-ttl')?.proposed).toBe(false)
    expect(s.nodes.get('auth-split-login')?.proposed).toBe(true)
    const res2 = await fetch(`http://127.0.0.1:${server.port}/api/accept/auth-split-login`, { method: 'POST' })
    expect(res2.ok).toBe(true)
    s = fold(mapLog())
    expect(s.nodes.get('auth-split-login')?.proposed).toBe(false)
  } finally {
    await server.close()
  }
})

test('82.2 an answer whose id is in the map stops the plan with an error that names it', () => {
  project([proposed('auth-token-ttl', { parent: 'auth', title: 'Existing ttl' }), accepted('auth-token-ttl')])
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT }, { spec: [ans('token-ttl')] })
  const r = p.werk(['plan', 'auth'])
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const ids = mapLog().filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl')
  expect(ids).toHaveLength(1)
  expect(fold(mapLog()).nodes.get('auth-token-ttl')?.title).toBe('Existing ttl')
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  project()
  writers({
    '01-login.md': ticket({ title: 'Log in', cites: 'auth-session', stories: '1', noStories: true }),
    '02-logout.md': ticket({ title: 'Log out', cites: 'auth, auth-login', stories: '1, 2' }),
  })
  const r = p.werk(['plan', 'auth'])
  const out = r.stdout + r.stderr
  expect(onBoard(2)).toBe(true)
  expect(onBoard(1)).toBe(false)
  expect(out).toMatch(/01-login\.md.*stories/)
  expect(out).toMatch(/no ticket cites.*auth-session/)
})

test('82.4 a ticket that names a failed ticket as a blocker is blocked, its good blocker goes to ready', () => {
  project()
  writers({
    '01-a.md': ticket({ title: 'Ticket a', cites: 'auth-session', stories: '1', noStories: true }),
    '02-b.md': ticket({ title: 'Ticket b', cites: 'auth, auth-login', stories: '1' }),
    '03-c.md': ticket({ title: 'Ticket c', cites: 'auth, auth-login, auth-session', blocked: '1, 2', stories: '2' }),
  })
  p.werk(['plan', 'auth'])
  expect(onBoard(1)).toBe(false)
  expect(columnOf(3)).toBe('blocked')
  expect(columnOf(2)).toBe('ready')
})

test('82.5 a second plan archives a dropped open ticket, and a restore puts it back', () => {
  project()
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(columnOf(1)).toBe('ready')
  expect(columnOf(2)).toBe('ready')
  writers({ '01-login.md': ticket({ title: 'Log in', cites: 'auth, auth-login, auth-session', stories: '1, 2' }) })
  { const r2 = p.werk(["plan", "auth"]); if (r2.code !== 0) console.log(r2.stdout, r2.stderr) }
  const archived = boardLog().filter((e) => e.type === 'ticket.archived')
  expect(archived).toHaveLength(1)
  expect(archived[0]).toMatchObject({ payload: { number: 2 } })
  expect((archived[0]!.payload as { reason: string }).reason).toMatch(/current spec .* no longer needs it/)
  expect(['ready', 'blocked']).toContain(columnOf(1)!)
  expect(onBoard(2)).toBe(false)
  const r = p.werk(['ticket', 'restore', '2', '--actor', 'you'])
  expect(r.code).toBe(0)
  expect(['ready', 'blocked']).toContain(columnOf(2)!)
})
