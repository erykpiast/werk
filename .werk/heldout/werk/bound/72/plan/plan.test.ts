/** Held-out steps 82.1–82.5: the plan verb with scripted fake writers. */
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

function project(extra: Parameters<typeof logOf> = []): Project {
  p = makeProject()
  const log = logOf(
    proposed('auth', { status: 'decided', who: 'you' }),
    proposed('auth-session', { status: 'decided', parent: 'auth' }),
    proposed('auth-token', { status: 'decided', parent: 'auth' }),
    accepted('auth-session'),
    accepted('auth-token'),
    ...extra,
  )
  mkdirSync(join(p.dir, '.werk'))
  writeFileSync(join(p.dir, '.werk', 'log.jsonl'), log.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return p
}

const SPEC = '# Spec\n\n## User Stories\n\n1. As a person, I want to log in, so that I work.\n2. As a person, I want to log out, so that I leave.\n'

type T = { title: string; cites?: string; blocked?: string; stories?: string | null; touches?: string | null }
function ticketText(t: T): string {
  return [
    `title: ${t.title}`,
    `cites: ${t.cites ?? ''}`,
    `blocked_by: ${t.blocked ?? ''}`,
    ...(t.stories === null ? [] : [`stories: ${t.stories ?? ''}`]),
    ...(t.touches === null ? [] : [`touches: ${t.touches ?? 'session'}`]),
    '',
    '## What to build',
    '',
    `Build ${t.title}.`,
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
}
const edit = (path: string, content: string): FakeStep => ({ edit: { path, content } })
type Answer = { slug: string; title: string; why: string; body: string }
const answer = (slug: string): Answer => ({ slug, title: `Title ${slug}`, why: `Why ${slug}?`, body: `Body ${slug}.` })

function writers(tickets: Record<string, string>, specAnswers: Answer[] = [], ticketAnswers: Answer[] = []) {
  p.scriptAgent({
    steps: [],
    roles: {
      'spec-writer': { steps: [edit(`${PLAN}/spec.md`, SPEC), edit(`${PLAN}/spec.answers.json`, JSON.stringify(specAnswers))] },
      'ticket-writer': {
        steps: [
          ...Object.entries(tickets).map(([name, text]) => edit(`${PLAN}/tickets/${name}`, text)),
          edit(`${PLAN}/tickets.answers.json`, JSON.stringify(ticketAnswers)),
        ],
      },
    },
  })
}

const mapLog = () => readLog<Event>(join(p.dir, '.werk', 'log.jsonl'))
const boardLog = () => readLog<BoardEvent>(join(p.dir, '.werk', 'board.jsonl'))
const board = () => foldBoard(boardLog())
const onBoard = () => board().columns.flatMap((c) => c.tickets.map((t) => ({ title: t.title, column: c.name, number: t.number })))

const LOGIN = ticketText({ title: 'login', cites: 'auth, auth-session', stories: '1' })
const LOGOUT = ticketText({ title: 'logout', cites: 'auth-token', stories: '2' })

test('82.1 a plan records a feature run, writes tickets, and proposes the answers as ghosts', () => {
  project()
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT }, [answer('token-ttl')], [answer('split-login')])
  const before = boardLog().length
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  expect(r.code).toBe(0)
  expect(boardLog()[before]).toMatchObject({ type: 'tier.recorded', payload: { tier: 'feature' } })
  expect(onBoard().map((t) => t.title).toSorted()).toEqual(['login', 'logout'])
  const state = fold(mapLog())
  for (const slug of ['token-ttl', 'split-login']) {
    const id = `auth-${slug}`
    const show = p.werk(['show', id]).stdout
    expect(show).toContain('state: ghost')
    expect(show).toContain('parent: #auth')
    expect(state.nodes.get(id)).toMatchObject({ proposed: true, title: `Title ${slug}`, why: `Why ${slug}?`, body: `Body ${slug}.` })
    // "the agent as the one who decides": who is not the person ("you").
    expect(state.nodes.get(id)?.who).toBeDefined()
    expect(state.nodes.get(id)?.who).not.toBe('you')
  }
  // ✓ maps to the same accept write path: one at a time.
  expect(p.werk(['accept', 'auth-token-ttl', '--actor', 'you']).code).toBe(0)
  expect(fold(mapLog()).nodes.get('auth-split-login')?.proposed).toBe(true)
  expect(fold(mapLog()).nodes.get('auth-token-ttl')?.proposed).toBe(false)
  expect(p.werk(['accept', 'auth-split-login', '--actor', 'you']).code).toBe(0)
  expect(fold(mapLog()).nodes.get('auth-split-login')?.proposed).toBe(false)
})

test('82.2 an answer with an id already in the map makes the plan exit with an error', () => {
  project([proposed('auth-token-ttl', { parent: 'auth' }), accepted('auth-token-ttl')])
  writers({ '01-login.md': LOGIN, '02-logout.md': ticketText({ title: 'logout', cites: 'auth-token, auth-token-ttl', stories: '2' }) }, [answer('token-ttl')])
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  expect(r.code).not.toBe(0)
  expect(r.stdout + r.stderr).toContain('token-ttl')
  const proposals = mapLog().filter((e) => e.type === 'node.proposed' && e.payload.id === 'auth-token-ttl')
  expect(proposals).toHaveLength(1)
})

test('82.3 a ticket that fails its own checks stays off the board and gives no coverage', () => {
  project()
  writers({
    '01-login.md': ticketText({ title: 'login', cites: 'auth-session', stories: null }),
    '02-logout.md': ticketText({ title: 'logout', cites: 'auth, auth-token', stories: '1, 2' }),
  })
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  const titles = onBoard().map((t) => t.title)
  expect(titles).toContain('logout')
  expect(titles).not.toContain('login')
  expect(r.stdout).toMatch(/01-login\.md: shape: stories: /)
  expect(r.stdout).toContain('no ticket cites the decided card #auth-session')
})

test('82.4 a ticket blocked by a failed ticket is blocked, and its correct blocker goes to ready', () => {
  project()
  writers({
    '01-a.md': ticketText({ title: 'a', cites: 'auth-session', stories: '1', touches: null }),
    '02-b.md': ticketText({ title: 'b', cites: 'auth, auth-token', stories: '2' }),
    '03-c.md': ticketText({ title: 'c', cites: 'auth-session', blocked: '1, 2', stories: '1' }),
  })
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  const t = onBoard()
  expect(t.map((x) => x.title)).not.toContain('a')
  expect(t.find((x) => x.title === 'c')?.column).toBe('blocked')
  expect(t.find((x) => x.title === 'b')?.column).toBe('ready')
})

test('82.5 a second plan archives a dropped open ticket, and a restore puts it back', () => {
  project()
  writers({ '01-login.md': LOGIN, '02-logout.md': LOGOUT })
  expect(p.werk(['plan', 'auth']).code).toBe(0)
  expect(onBoard().map((t) => t.title).toSorted()).toEqual(['login', 'logout'])
  writers({ '01-login.md': ticketText({ title: 'login', cites: 'auth, auth-session, auth-token', stories: '1, 2' }) })
  const r = p.werk(['plan', 'auth'])
  console.log(r.stdout, r.stderr)
  const archived = boardLog().filter((e) => e.type === 'ticket.archived')
  expect(archived).toHaveLength(1)
  expect(archived[0]).toMatchObject({ payload: { number: 2 } })
  expect((archived[0]!.payload as { reason: string }).reason).toMatch(/current spec .*no longer needs it/)
  expect(onBoard().find((t) => t.title === 'login')?.column).toMatch(/^(ready|blocked)$/)
  expect(onBoard().map((t) => t.title)).not.toContain('logout')

  // The person restores "logout". Look for a verb that restores a ticket.
  const help = p.werk(['help']).stdout
  console.log('help restore lines:', help.split('\n').filter((l) => /restore|archiv|ticket/.test(l)))
  const restore = p.werk(['restore', '2'])
  console.log('restore 2 →', restore.code, restore.stdout, restore.stderr)
  expect(onBoard().map((t) => t.title)).toContain('logout')
})
